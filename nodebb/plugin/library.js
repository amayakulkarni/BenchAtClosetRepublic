'use strict';

// Closet Republic plugin for NodeBB 4.
//
// 0. The Closet Republic look (theme.js): dark prism skin, nature mode, logo, favicon, emails.
// 1. "Log in with Discord". New members get a random pseudonym (citizen-xxxxxx) instead of
//    their Discord name, so the forum never reveals who someone is on Discord. They can
//    rename themselves afterwards. The Discord link is stored privately (discordId:uid).
// 2. Every topic/post change is sent to the bridge (cr-bridge) as a small signed event.
//    The bridge looks the details up itself through the Write API, decides what to sync to
//    Reddit, and recomputes role tiers when someone logs in.
//
// Configuration comes from the environment (set it in the pm2 ecosystem file):
//   CR_DISCORD_CLIENT_ID, CR_DISCORD_CLIENT_SECRET  Discord application (OAuth2)
//   CR_BRIDGE_URL      e.g. http://127.0.0.1:40007   (empty = do not send events)
//   CR_BRIDGE_SECRET   shared HMAC secret with the bridge
//   CR_BRIDGE_UID      the forum account the bridge posts as; its own events are not sent back
//   CR_DISCORD_BASE    only for tests against a mock Discord (default https://discord.com)
//   CR_STORE_EMAIL     "false" to never store the Discord email (Buy Me a Coffee matching then
//                      needs the member to add an email themselves)

const crypto = require('node:crypto');
const OAuth2Strategy = require('passport-oauth2');

const passport = require.main.require('passport');
const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const db = require.main.require('./src/database');
const user = require.main.require('./src/user');
const authenticationController = require.main.require('./src/controllers/authentication');

const theme = require('./theme');

const NAME = 'discord';
// Only changed for testing against a mock (see docs/testing.md).
const DISCORD = (process.env.CR_DISCORD_BASE || 'https://discord.com').replace(/\/$/, '');
const env = (key, fallback = '') => (process.env[key] || '').trim() || fallback;

const Plugin = module.exports;

// ---------------------------------------------------------------- look

Plugin.init = async params => theme.init(params);
Plugin.addConfig = theme.addConfig;
Plugin.addLinkTags = theme.addLinkTags;

// ---------------------------------------------------------------- Discord login

Plugin.loadStrategies = async (strategies) => {
	const clientID = env('CR_DISCORD_CLIENT_ID');
	const clientSecret = env('CR_DISCORD_CLIENT_SECRET');
	if (!clientID || !clientSecret) {
		winston.warn('[closet-republic] CR_DISCORD_CLIENT_ID/SECRET not set: Discord login is off');
		return strategies;
	}

	const strategy = new OAuth2Strategy({
		authorizationURL: `${DISCORD}/oauth2/authorize`,
		tokenURL: `${DISCORD}/api/oauth2/token`,
		clientID,
		clientSecret,
		callbackURL: `${nconf.get('url')}/auth/${NAME}/callback`,
		scope: ['identify', 'email'],
		// No passport state store: NodeBB creates and checks the state itself (checkState below).
		passReqToCallback: true,
	}, async (req, accessToken, refreshToken, profile, done) => {
		try {
			const uid = await Plugin.login(req, profile);
			await authenticationController.onSuccessfulLogin(req, uid);
			notifyBridge('login', { uid, discordId: profile.id });
			done(null, { uid });
		} catch (err) {
			done(err);
		}
	});

	strategy.userProfile = (accessToken, done) => {
		fetch(`${DISCORD}/api/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } })
			.then(async (res) => {
				if (!res.ok) throw new Error(`Discord /users/@me returned ${res.status}`);
				done(null, await res.json());
			})
			.catch(done);
	};

	passport.use(NAME, strategy);
	strategies.push({
		name: NAME,
		url: `/auth/${NAME}`,
		callbackURL: `/auth/${NAME}/callback`,
		checkState: true,
		icon: 'fa-brands fa-discord',
		icons: { normal: 'fa-brands fa-discord', square: 'fa-brands fa-discord' },
		labels: { login: 'Log in with Discord', register: 'Join with Discord' },
		color: '#5865F2',
		scope: 'identify email',
	});
	return strategies;
};

Plugin.login = async (req, profile) => {
	if (!profile || !profile.id) throw new Error('[[error:invalid-data]]');

	// Already linked: same forum account.
	let uid = await db.getObjectField(`${NAME}Id:uid`, profile.id);
	if (uid) return parseInt(uid, 10);

	// Logged in already and linking Discord from the "linked accounts" page.
	if (req.user && req.user.uid > 0) {
		uid = req.user.uid;
	} else {
		const pseudonym = `citizen-${crypto.randomBytes(3).toString('hex')}`;
		uid = await user.create({ username: pseudonym });
		const storeEmail = env('CR_STORE_EMAIL', 'true') !== 'false';
		if (storeEmail && profile.email && profile.verified) {
			// Only verified Discord emails, and NodeBB keeps emails private by default. The bridge
			// uses it to match Buy Me a Coffee supporters, who are identified by email.
			const taken = await user.getUidByEmail(profile.email);
			if (!taken) {
				await user.setUserField(uid, 'email', profile.email);
				await user.email.confirmByUid(uid);
			}
		}
	}

	await user.setUserField(uid, `${NAME}Id`, profile.id);
	await db.setObjectField(`${NAME}Id:uid`, profile.id, uid);
	return uid;
};

Plugin.listAssociations = async (data) => {
	const discordId = await user.getUserField(data.uid, `${NAME}Id`);
	if (discordId) {
		data.associations.push({
			associated: true,
			name: 'Discord',
			icon: 'fa-brands fa-discord',
			deauthUrl: null,
		});
	} else {
		data.associations.push({
			associated: false,
			url: `${nconf.get('url')}/auth/${NAME}`,
			name: 'Discord',
			icon: 'fa-brands fa-discord',
		});
	}
	return data;
};

Plugin.deleteUserData = async ({ uid }) => {
	const discordId = await user.getUserField(uid, `${NAME}Id`);
	if (discordId) await db.deleteObjectField(`${NAME}Id:uid`, discordId);
	notifyBridge('user.delete', { uid });
};

// ---------------------------------------------------------------- events for the bridge

const fromBridge = (uid) => String(uid) === String(env('CR_BRIDGE_UID', '-1'));

function topicEvent(name) {
	return async ({ topic, post, uid }) => {
		const t = topic || {};
		if (name === 'topic.post' && fromBridge(t.uid)) return;
		if (name !== 'topic.post' && fromBridge(uid)) return;
		notifyBridge(name, { tid: t.tid, cid: t.cid, uid: t.uid, pid: (post && post.pid) || t.mainPid, by: uid });
	};
}

function postEvent(name) {
	return async ({ post, uid }) => {
		const p = (post && post.post) || post || {};
		const by = uid || p.uid;
		if (fromBridge(by)) return;
		// A topic's first post also fires post.save; topic.post covers it.
		if (name === 'post.save' && p.isMain) return;
		notifyBridge(name, { pid: p.pid, tid: p.tid, uid: p.uid, by });
	};
}

Plugin.onTopicPost = topicEvent('topic.post');
Plugin.onTopicEdit = topicEvent('topic.edit');
Plugin.onTopicDelete = topicEvent('topic.delete');
Plugin.onTopicRestore = topicEvent('topic.restore');
Plugin.onTopicPurge = topicEvent('topic.purge');
Plugin.onPostSave = postEvent('post.save');
Plugin.onPostEdit = postEvent('post.edit');
Plugin.onPostDelete = postEvent('post.delete');
Plugin.onPostRestore = postEvent('post.restore');

function notifyBridge(event, data) {
	const base = env('CR_BRIDGE_URL');
	const secret = env('CR_BRIDGE_SECRET');
	if (!base || !secret) return;
	const body = JSON.stringify({ event, at: Date.now(), ...data });
	const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
	// Fire and forget: the forum never waits for the bridge. The bridge's reconcile loop
	// catches anything an outage made it miss.
	fetch(`${base.replace(/\/$/, '')}/internal/nodebb-event`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-cr-signature': signature },
		body,
		signal: AbortSignal.timeout(5000),
	}).catch((err) => winston.warn(`[closet-republic] bridge unreachable for ${event}: ${err.message}`));
}
