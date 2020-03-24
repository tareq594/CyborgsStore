// config used by server side only
const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = process.env.DB_PORT || 27017;
const dbName = process.env.DB_NAME || 'shop';
const dbUser = process.env.DB_USER || '';
const dbPass = process.env.DB_PASS || '';
const dbCred =
	dbUser.length > 0 || dbPass.length > 0 ? `${dbUser}:${dbPass}@` : '';

const dbUrl =
	process.env.DB_URL || `mongodb://${dbCred}${dbHost}:${dbPort}/${dbName}`;

module.exports = {
	// used by Store (server side)
	apiBaseUrl:
		process.env.API_BASE_URL || `https://api.demo.store.cyborgstech.com/api/v1`,

	// Access-Control-Allow-Origin
	storeBaseUrl:
		process.env.STORE_BASE_URL || `https://demo.store.cyborgstech.com`,

	// used by API
	adminBaseURL:
		process.env.ADMIN_BASE_URL || 'https://admin.demo.store.cyborgstech.com',
	adminLoginPath: process.env.ADMIN_LOGIN_PATH || '/login',

	apiListenPort: process.env.API_PORT || 3001,

	// used by API
	mongodbServerUrl: dbUrl,

	// assest
	assetServer: {
		type: process.env.ASSETS_TYPE || 'local', // 'local' | 's3'
		domain:
			process.env.ASSETS_BASE_URL || 'https://api.demo.store.cyborgstech.com', // add localBasePath to S3 domain
		localBasePath: 'public/content',
		categoriesUploadPath: 'images/categories',
		productsUploadPath: 'images/products',
		themeImageUploadPath: 'assets/images',
		filesUploadPath: 'assets',
		// S3 Config
		bucket: 'cezerin2-asset-test'
	},

	// smpt server parameters
	smtpServer: {
		host: process.env.SMTP_HOST || 'smtp.gmail.com',
		port: process.env.SMTP_PORT || 587,
		secure: process.env.SMTP_SECURE || false,
		user: process.env.SMTP_USER || 'tareq.sanabra@gmail.com',
		pass: process.env.SMTP_PASS || '@MeenhoonTareq',
		fromName: process.env.SMTP_FROM_NAME || 'Cyborgs',
		fromAddress: process.env.SMTP_FROM_ADDRESS || 'amman'
	},

	// key to sign tokens
	jwtSecretKey: process.env.JWT_SECRET_KEY || '@MeenZaidTareq',

	// key to sign store cookies
	cookieSecretKey: process.env.COOKIE_SECRET_KEY || '@MeenZaidTareq',

	// store UI language
	language: process.env.LANGUAGE || 'en',

	// used by API
	orderStartNumber: 1000,

	// cost factor, controls how much time is needed to calculate a single BCrypt hash
	// for production: recommended salRounds > 12
	saltRounds: process.env.SALT_ROUNDS || 15,

	developerMode: process.env.DEVELOPER_MODE || true
};
