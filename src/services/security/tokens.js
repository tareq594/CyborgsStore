import { ObjectID } from 'mongodb';
import url from 'url';
import jwt from 'jsonwebtoken';
import moment from 'moment';
import uaParser from 'ua-parser-js';
import handlebars from 'handlebars';
import lruCache from 'lru-cache';
import { db } from '../../lib/mongo';
import parse from '../../lib/parse';
import settings from '../../lib/settings';
import mailer from '../../lib/mailer';
import SettingsService from '../settings/settings';
const bcrypt = require('bcrypt');

const validateRegisterInput = require('../validation/register');
const validateLoginInput = require('../validation/login');
const { saltRounds } = settings;

const cache = lruCache({
	max: 10000,
	maxAge: 1000 * 60 * 60 * 24 // 24h
});

const BLACKLIST_CACHE_KEY = 'blacklist';

class SecurityTokensService {
	getTokens(params = {}) {
		const filter = {
			is_revoked: false
		};
		const id = parse.getObjectIDIfValid(params.id);
		if (id) {
			filter._id = new ObjectID(id);
		}

		const email = parse.getString(params.email).toLowerCase();
		if (email && email.length > 0) {
			filter.email = email;
		}

		return db
			.collection('tokens')
			.find(filter)
			.toArray()
			.then(items => items.map(item => this.changeProperties(item)));
	}

	getTokensBlacklist() {
		const blacklistFromCache = cache.get(BLACKLIST_CACHE_KEY);

		if (blacklistFromCache) {
			return Promise.resolve(blacklistFromCache);
		}
		return db
			.collection('tokens')
			.find(
				{
					is_revoked: true
				},
				{ _id: 1 }
			)
			.toArray()
			.then(items => {
				const blacklistFromDB = items.map(item => item._id.toString());
				cache.set(BLACKLIST_CACHE_KEY, blacklistFromDB);
				return blacklistFromDB;
			});
	}

	getSingleToken(id) {
		if (!ObjectID.isValid(id)) {
			return Promise.reject('Invalid identifier');
		}
		return this.getTokens({ id }).then(items =>
			items.length > 0 ? items[0] : null
		);
	}

	getSingleTokenByEmail(email) {
		return this.getTokens({ email }).then(items =>
			items.length > 0 ? items[0] : null
		);
	}

	addToken(data) {
		return this.getValidDocumentForInsert(data)
			.then(tokenData => db.collection('tokens').insertMany([tokenData]))
			.then(res => this.getSingleToken(res.ops[0]._id.toString()))
			.then(token =>
				this.getSignedToken(token).then(signedToken => {
					token.token = signedToken;
					return token;
				})
			);
	}

	updateToken(id, data) {
		if (!ObjectID.isValid(id)) {
			return Promise.reject('Invalid identifier');
		}
		const tokenObjectID = new ObjectID(id);
		const token = this.getValidDocumentForUpdate(id, data);

		return db
			.collection('tokens')
			.updateOne(
				{
					_id: tokenObjectID
				},
				{ $set: token }
			)
			.then(res => this.getSingleToken(id));
	}

	deleteToken(id) {
		if (!ObjectID.isValid(id)) {
			return Promise.reject('Invalid identifier');
		}
		const tokenObjectID = new ObjectID(id);
		return db
			.collection('tokens')
			.updateOne(
				{
					_id: tokenObjectID
				},
				{
					$set: {
						is_revoked: true,
						date_created: new Date()
					}
				}
			)
			.then(res => {
				cache.del(BLACKLIST_CACHE_KEY);
			});
	}

	checkTokenEmailUnique(email) {
		if (email && email.length > 0) {
			return db
				.collection('tokens')
				.count({ email, is_revoked: false })
				.then(count =>
					count === 0 ? email : Promise.reject('Token email must be unique')
				);
		}
		return Promise.resolve(email);
	}

	getValidDocumentForInsert(data) {
		const email = parse.getString(data.email);
		return this.checkTokenEmailUnique(email).then(email => {
			const token = {
				is_revoked: false,
				date_created: new Date()
			};

			token.name = parse.getString(data.name);
			if (email && email.length > 0) {
				token.email = email.toLowerCase();
			}
			token.scopes = parse.getArrayIfValid(data.scopes);
			token.expiration = parse.getNumberIfPositive(data.expiration);

			return token;
		});
	}

	getValidDocumentForUpdate(id, data) {
		if (Object.keys(data).length === 0) {
			return new Error('Required fields are missing');
		}

		const token = {
			date_updated: new Date()
		};

		if (data.name !== undefined) {
			token.name = parse.getString(data.name);
		}

		if (data.expiration !== undefined) {
			token.expiration = parse.getNumberIfPositive(data.expiration);
		}

		return token;
	}

	changeProperties(item) {
		if (item) {
			item.id = item._id.toString();
			delete item._id;
			delete item.is_revoked;
		}

		return item;
	}

	getSignedToken(token) {
		return new Promise((resolve, reject) => {
			const jwtOptions = {};

			const payload = {
				scopes: token.scopes,
				jti: token.id
			};

			if (token.email && token.email.length > 0) {
				payload.email = token.email.toLowerCase();
			}

			if (token.expiration) {
				// convert hour to sec
				jwtOptions.expiresIn = token.expiration * 60 * 60;
			}

			jwt.sign(payload, settings.jwtSecretKey, jwtOptions, (err, token) => {
				if (err) {
					reject(err);
				} else {
					resolve(token);
				}
			});
		});
	}

	getDashboardSigninUrl(email) {
		return SettingsService.getSettings().then(generalSettings =>
			this.getSingleTokenByEmail(email).then(token => {
				if (token) {
					return this.getSignedToken(token).then(signedToken => {
						const loginUrl = url.resolve(
							settings.adminBaseURL,
							settings.adminLoginPath
						);
						return `${loginUrl}?token=${signedToken}`;
					});
				}
				return null;
			})
		);
	}

	getIP(req) {
		let ip = req.get('x-forwarded-for') || req.ip;

		if (ip && ip.includes(', ')) {
			ip = ip.split(', ')[0];
		}

		if (ip && ip.includes('::ffff:')) {
			ip = ip.replace('::ffff:', '');
		}

		if (ip === '::1') {
			ip = 'localhost';
		}

		return ip;
	}

	getTextFromHandlebars(text, context) {
		const template = handlebars.compile(text, { noEscape: true });
		return template(context);
	}

	getSigninMailSubject() {
		return 'New sign-in from {{from}}';
	}

	getSigninMailBody() {
		return `<div style="color: #202020; line-height: 1.5;">
      Your email address {{email}} was just used to request<br />a sign in email to {{domain}} dashboard.
      <div style="padding: 60px 0px;"><a href="{{link}}" style="background-color: #3f51b5; color: #ffffff; padding: 12px 26px; font-size: 18px; border-radius: 28px; text-decoration: none;">Click here to sign in</a></div>
      <b>Request from</b>
      <div style="color: #727272; padding: 0 0 20px 0;">{{requestFrom}}</div>
      If this was not you, you can safely ignore this email.<br /><br />
      Best,<br />
      Cezerin Robot`;
	}

	async sendDashboardSigninUrl(req) {
		const { email } = req.body;
		const userAgent = uaParser(req.get('user-agent'));
		const country = req.get('cf-ipcountry') || '';
		const ip = this.getIP(req);
		const date = moment(new Date()).format('dddd, MMMM DD, YYYY h:mm A');
		const link = await this.getDashboardSigninUrl(email);

		if (link) {
			const linkObj = url.parse(link);
			const domain = `${linkObj.protocol}//${linkObj.host}`;
			const device = userAgent.device.vendor
				? `${userAgent.device.vendor} ${userAgent.device.model}, `
				: '';
			const requestFrom = `${device}${userAgent.os.name}, ${userAgent.browser.name}<br />
      ${date}<br />
      IP: ${ip}<br />
      ${country}`;

			const message = {
				to: email,
				subject: this.getTextFromHandlebars(this.getSigninMailSubject(), {
					from: userAgent.os.name
				}),
				html: this.getTextFromHandlebars(this.getSigninMailBody(), {
					link,
					email,
					domain,
					requestFrom
				})
			};
			const emailSent = await mailer.send(message);
			return { sent: emailSent, error: null };
		}
		return { sent: false, error: 'Access Denied' };
	}

	async authorizeWithEmailAndPassword(req, res, next) {
		var { email, password } = req.body;
		const { errors, isValid } = validateLoginInput(req.body);
		if (!isValid) {
			const emailError = errors.email || '';
			const passwordError = errors.password || '';
			return res.json({
				error: emailError + ' ' + passwordError,
				isAuthorized: false
			});
		}
		email = email.toLowerCase();

		db.collection('adminusers')
			.findOne({ email: email })
			.then(user => {
				if (!user) {
					errors.email = 'User not found';
					return res.json({ error: errors.email, isAuthorized: false });
				}
				bcrypt.compare(password, user.password).then(isMatch => {
					if (isMatch) {
						const payload = {
							id: user.id,
							name: user.name
						};
						jwt.sign(
							payload,
							settings.jwtSecretKey,
							{
								expiresIn: 864000
							},
							(err, token) => {
								if (err) console.error('There is some error in token', err);
								else {
									res.json({
										success: true,
										isAuthorized: true,
										token: `${token}`
									});
								}
							}
						);
					} else {
						errors.password = 'Incorrect Password';
						return res.json({ error: errors.password, isAuthorized: false });
					}
				});
			});
	}

	async registeradmin(req, res, next) {
		const { email, password, password_confirm } = req.body;
		const { errors, isValid } = validateRegisterInput(req.body);
		if (!isValid) {
			return res.status(400).json(errors);
		}
		db.collection('adminusers')
			.findOne({ email: email.toLowerCase() })
			.then(user => {
				if (user) {
					return res.status(400).json({
						email: 'Email already exists'
					});
				} else {
					const newUser = {
						name: req.body.name,
						email: req.body.email.toLowerCase(),
						password: req.body.password
					};

					bcrypt.genSalt(saltRounds, (err, salt) => {
						if (err) console.error('There was an error', err);
						else {
							bcrypt.hash(newUser.password, salt, (err, hash) => {
								if (err) console.error('There was an error', err);
								else {
									newUser.password = hash;
									db.collection('adminusers')
										.insertOne(newUser)
										.then(user => {
											res.json(user);
										});
								}
							});
						}
					});
				}
			});
	}
}

export default new SecurityTokensService();
