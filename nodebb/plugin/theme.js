'use strict';

// Closet Republic look, server side.
//
// Every start:  stores skin/variables.scss as the custom skin "Closet Republic", so changes to
//               that file reach the forum after a restart.
// Once:         makes that skin the default (and the only one: members cannot switch to a light
//               skin), and sets the favicon, phone icons, email logo, share image and site title.
//               This runs again only when BRAND_VERSION below goes up, so anything changed later
//               in the admin panel is otherwise left alone.
//
// Environment:
//   CR_MAIN_SITE_URL   address of the main site, for header and footer links
//                      (default https://closetrepublic.com)

const fs = require('node:fs');
const path = require('node:path');

const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const meta = require.main.require('./src/meta');
const db = require.main.require('./src/database');

const PLUGIN_ID = 'nodebb-plugin-closet-republic';
const SKIN_NAME = 'Closet Republic';
const SKIN_ID = 'closet-republic';
const BRAND_VERSION = 1;
const BRAND_URL = `/assets/plugins/${PLUGIN_ID}/brand`;
const BRAND_DIR = path.join(__dirname, 'static', 'brand');
const EMAIL_LOGO_PATH = '/closet-republic/email-logo.png';
const TOUCH_SIZES = [36, 48, 72, 96, 144, 192];

const Theme = module.exports;

Theme.siteUrl = () => (process.env.CR_MAIN_SITE_URL || 'https://closetrepublic.com').replace(/\/$/, '');

Theme.init = async ({ router }) => {
	// The email logo is fetched by mail apps from other sites, so it is served with a header that
	// allows that (NodeBB's own files only allow the forum itself).
	router.get(EMAIL_LOGO_PATH, (req, res) => {
		res.set('Cross-Origin-Resource-Policy', 'cross-origin');
		res.set('Cache-Control', 'public, max-age=604800');
		res.sendFile(path.join(BRAND_DIR, 'email-logo.png'));
	});
	try {
		await saveSkin();
		const done = parseInt(await db.getObjectField('closet-republic:theme', 'brandVersion'), 10) || 0;
		if (done < BRAND_VERSION) {
			await applyBranding();
			await db.setObjectField('closet-republic:theme', 'brandVersion', BRAND_VERSION);
			winston.info(`[closet-republic] applied the Closet Republic look (version ${BRAND_VERSION})`);
		}
	} catch (err) {
		winston.error(`[closet-republic] could not apply the Closet Republic look: ${err.stack}`);
	}
};

// Header and footer links point at the main site.
Theme.addConfig = async (config) => {
	config.closetRepublic = { siteUrl: Theme.siteUrl() };
	return config;
};

// A sharp SVG favicon next to the .ico one.
Theme.addLinkTags = async (data) => {
	data.links.push({ rel: 'icon', type: 'image/svg+xml', href: `${nconf.get('relative_path')}${BRAND_URL}/icon.svg` });
	return data;
};

async function saveSkin() {
	const variables = await fs.promises.readFile(path.join(__dirname, 'skin', 'variables.scss'), 'utf8');
	const current = await meta.settings.get('custom-skins');
	const list = Array.isArray(current['custom-skin-list']) ? current['custom-skin-list'].filter(Boolean) : [];
	const others = list.filter(skin => skin['custom-skin-name'] !== SKIN_NAME);
	const ours = list.find(skin => skin['custom-skin-name'] === SKIN_NAME);
	if (ours && ours._variables === variables) {
		return;
	}
	await meta.settings.set('custom-skins', {
		'custom-skin-list': others.concat([{ 'custom-skin-name': SKIN_NAME, _variables: variables }]),
	});
	// Drop the old compiled skin so it is rebuilt with the new variables on the next page load.
	const built = path.join(nconf.get('base_dir'), 'build', 'public');
	await Promise.all([`client-${SKIN_ID}.css`, `client-${SKIN_ID}-rtl.css`].map(
		file => fs.promises.rm(path.join(built, file), { force: true })
	));
	winston.info('[closet-republic] saved the "Closet Republic" skin');
}

async function applyBranding() {
	const uploads = path.join(nconf.get('upload_path'), 'system');
	await fs.promises.mkdir(uploads, { recursive: true });

	// Phone and tablet icons: NodeBB looks for these names when brand:touchIcon is set.
	await Promise.all(TOUCH_SIZES.map(size => fs.promises.copyFile(
		path.join(BRAND_DIR, `touchicon-${size}.png`), path.join(uploads, `touchicon-${size}.png`)
	)));
	await fs.promises.copyFile(path.join(BRAND_DIR, 'touchicon-512.png'), path.join(uploads, 'touchicon-orig.png'));

	const now = Date.now();
	const settings = {
		bootswatchSkin: SKIN_ID,
		disableCustomUserSkins: 1,
		'brand:favicon': `${BRAND_URL}/favicon.ico`,
		'brand:favicon:updatedAt': now,
		'brand:touchIcon': `/assets/uploads/system/touchicon-orig.png`,
		'brand:touchIcon:updatedAt': now,
		// A full address: mail apps open it from outside the forum.
		'brand:emailLogo': `${nconf.get('url')}${EMAIL_LOGO_PATH}`,
		'brand:emailLogo:width': 178,
		'brand:emailLogo:height': 122,
		'og:image': `${BRAND_URL}/social-logo.png`,
		'og:image:width': 669,
		'og:image:height': 669,
		'og:image:updatedAt': now,
		showSiteTitle: 0,
		// Browser and phone app colours (address bar, splash screen).
		themeColor: '#000000',
		backgroundColor: '#000000',
	};
	if (!meta.config.title || meta.config.title === 'NodeBB') {
		settings.title = 'Closet Republic Forum';
		settings['title:url'] = '';
	}
	if (!meta.config.browserTitle || meta.config.browserTitle === 'NodeBB') {
		settings.browserTitle = 'Closet Republic Forum';
	}
	if (!meta.config.description) {
		settings.description = 'The forum of Closet Republic, a parody online nation for people who once hid who they are to fit in.';
	}
	await meta.configs.setMultiple(settings);
	// Dark, high-contrast colours for code blocks (Markdown plugin).
	await meta.settings.setOne('markdown', 'highlightTheme', 'a11y-dark.css');
}
