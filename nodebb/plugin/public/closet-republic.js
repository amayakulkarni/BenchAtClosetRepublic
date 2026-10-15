'use strict';

// Closet Republic look, browser side: nature mode (switch, swipe, ?nature=), the prism layers,
// the footer, and the forced-theme alert. Same behaviour as closetrepublic.com.

(function () {
	const COOKIE = 'cr_nature';
	const QUERY_NAMES = ['nature', 'paradoy', 'parody'];
	const PRISM_DESCRIPTION = 'Nature mode is on. The page looks as if it is seen through a curved prism: near the top and bottom of the screen, and in a circle around your pointer, white softly melts into pastel rainbow colours and other colours take on a gentle tint of their own spectrum. Content in the middle of the screen is not distorted.';
	const MONO_DESCRIPTION = 'Nature mode is off. The page is shown in plain monochrome black and white.';
	const THEME_ALERT = 'CR looks best as is and developers have made huge efforts to make their artwork accessible to everyone. Please disable forced theme (light/dark) to taste the art as it was meant to.';

	const SWIPE_MIN_X = 90;
	const SWIPE_MAX_Y = 60;
	const SWIPE_MAX_MS = 700;

	const html = document.documentElement;
	const siteUrl = ((window.config && config.closetRepublic && config.closetRepublic.siteUrl) || 'https://closetrepublic.com').replace(/\/$/, '');

	function isOn() {
		return html.getAttribute('data-nature') !== 'off';
	}

	function parseValue(value) {
		if (value == null) return null;
		const v = String(value).toLowerCase();
		if (['true', '1', 'on', 'yes'].includes(v)) return true;
		if (['false', '0', 'off', 'no'].includes(v)) return false;
		return null;
	}

	// ------------------------------------------------------------ prism layers

	let cursor = null;
	let frame = 0;
	let px = 0;
	let py = 0;

	function ensurePrism() {
		if (document.querySelector('.cr-prism-layers')) return;
		const layers = document.createElement('div');
		layers.className = 'cr-prism-layers';
		layers.setAttribute('aria-hidden', 'true');
		layers.innerHTML = '<div class="cr-prism cr-prism--top"></div><div class="cr-prism cr-prism--bottom"></div><div class="cr-prism-cursor" data-active="false"></div>';
		document.body.appendChild(layers);
		cursor = layers.querySelector('.cr-prism-cursor');
	}

	function paint() {
		frame = 0;
		if (cursor) cursor.style.transform = `translate3d(${px}px, ${py}px, 0)`;
	}
	function onPointer(e) {
		if (!cursor || !isOn()) return;
		px = e.clientX;
		py = e.clientY;
		cursor.dataset.active = 'true';
		if (!frame) frame = requestAnimationFrame(paint);
	}
	function hideCursor() {
		if (cursor) cursor.dataset.active = 'false';
	}
	window.addEventListener('pointermove', onPointer, { passive: true });
	window.addEventListener('pointerdown', onPointer, { passive: true });
	window.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') hideCursor(); }, { passive: true });
	html.addEventListener('pointerleave', hideCursor);
	window.addEventListener('blur', hideCursor);

	// ------------------------------------------------------------ nature mode

	function render() {
		const on = isOn();
		document.querySelectorAll('[component="closet-republic/nature-toggle"]').forEach((el) => {
			el.setAttribute('aria-checked', on ? 'true' : 'false');
		});
		const description = document.getElementById('cr-visual-mode-description');
		if (description) description.textContent = on ? PRISM_DESCRIPTION : MONO_DESCRIPTION;
		if (on) ensurePrism();
		else hideCursor();
	}

	function setNature(next) {
		html.setAttribute('data-nature', next ? 'on' : 'off');
		document.cookie = `${COOKIE}=${next ? 1 : 0}; path=/; max-age=31536000; samesite=lax`;
		// Drop a ?nature= from the address so it does not override the new choice on reload.
		const url = new URL(window.location.href);
		if (QUERY_NAMES.some(n => url.searchParams.has(n))) {
			QUERY_NAMES.forEach(n => url.searchParams.delete(n));
			window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
		}
		render();
		const announce = document.querySelector('[component="closet-republic/announce"]');
		if (announce) announce.textContent = next ? PRISM_DESCRIPTION : MONO_DESCRIPTION;
	}

	function toggle() {
		setNature(!isOn());
	}

	document.addEventListener('click', (e) => {
		if (e.target.closest('[component="closet-republic/nature-toggle"]')) toggle();
	});

	// A quick horizontal swipe anywhere on the page toggles nature mode.
	let start = null;
	function ignoreSwipe(target) {
		if (!(target instanceof Element)) return false;
		if (target.closest('input, textarea, select, [contenteditable], [data-no-swipe], .composer, [component="composer"], .modal, .dropdown-menu')) return true;
		for (let el = target; el && el !== document.body; el = el.parentElement) {
			if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible') return true;
		}
		return false;
	}
	window.addEventListener('touchstart', (e) => {
		if (e.touches.length !== 1 || ignoreSwipe(e.target)) {
			start = null;
			return;
		}
		start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
	}, { passive: true });
	window.addEventListener('touchend', (e) => {
		if (!start) return;
		const t = e.changedTouches[0];
		const dx = t.clientX - start.x;
		const dy = t.clientY - start.y;
		if (Math.abs(dx) >= SWIPE_MIN_X && Math.abs(dy) <= SWIPE_MAX_Y && Date.now() - start.t <= SWIPE_MAX_MS) toggle();
		start = null;
	}, { passive: true });

	// A ?nature= link followed inside the forum (without a full page load) still switches the mode.
	function applyQuery() {
		const params = new URLSearchParams(window.location.search);
		for (const name of QUERY_NAMES) {
			const value = parseValue(params.get(name));
			if (value !== null) {
				html.setAttribute('data-nature', value ? 'on' : 'off');
				return;
			}
		}
	}

	// ------------------------------------------------------------ footer

	function ensureFooter() {
		const panel = document.getElementById('panel');
		const content = document.getElementById('content');
		if (!panel || !content || panel.querySelector('.cr-footer')) return;
		const footer = document.createElement('footer');
		footer.className = 'container-lg px-md-4 cr-footer';
		footer.innerHTML = `<div class="cr-footer__inner">
			<div class="cr-footer__brand">
				<svg class="cr-mark" viewBox="0 0 160 160" width="28" height="28" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="10"><path d="M138.38,150H21.62c-6.42,0-11.62-5.2-11.62-11.62V21.62c0-6.42,5.2-11.62,11.62-11.62h116.75c6.42,0,11.62,5.2,11.62,11.62v116.75c0,6.42-5.2,11.62-11.62,11.62Z"/><path d="M80,10c.25,18.19-.25,121.3,0,140"/><path d="M93.9,68.63c0,7.08.51,15.67.51,26.28"/><path d="M66.1,68.63v26.28"/></g></svg>
				<span>Closet Republic · Naturally exceptional</span>
			</div>
			<nav aria-label="Closet Republic site">
				<ul>
					<li><a href="${siteUrl}/about">About</a></li>
					<li><a href="${siteUrl}/gazette">Gazette</a></li>
					<li><a href="${siteUrl}/constitution">Constitution</a></li>
					<li><a href="${siteUrl}/funding">Funding</a></li>
					<li><a href="${siteUrl}/lifeline">Lifeline</a></li>
					<li><a href="https://github.com/amayakulkarni/ClosetRepublic" target="_blank" rel="noopener noreferrer">GitHub<span class="cr-sr-only"> (opens in a new tab)</span></a></li>
				</ul>
			</nav>
			<nav aria-label="Legal">
				<ul>
					<li><a href="${siteUrl}/guidelines">Community Guidelines</a></li>
					<li><a href="${siteUrl}/terms">Terms</a></li>
					<li><a href="${siteUrl}/privacy">Privacy</a></li>
				</ul>
			</nav>
			<p class="cr-footer__small">Closet Republic is a parody micronation and online community, not a state or registered charity. No trackers, no ads.</p>
			<p class="cr-footer__small">Swipe sideways or use the Nature switch to change modes. Add <code>?nature=true</code> or <code>?nature=false</code> to any link to share a mode.</p>
			<p class="cr-footer__small"><a href="https://amayakulkarni.com" target="_blank" rel="noopener noreferrer">Created by amaya@veronami<span class="cr-sr-only"> (opens amayakulkarni.com in a new tab)</span></a></p>
			</div>`;
		content.after(footer);
	}

	// ------------------------------------------------------------ forced theme alert

	// Closet Republic is dark only. If the browser or an extension forces its own theme
	// (forced colours / high contrast, Dark Reader and similar, or injected styles that
	// repaint the page), the visitor is asked to turn it off.
	function watchForcedTheme() {
		if (!document.body.classList.contains('skin-closet-republic')) return;
		let warned = false;
		const warn = () => {
			if (warned) return;
			warned = true;
			window.alert(THEME_ALERT);
		};
		const probe = document.createElement('div');
		probe.setAttribute('aria-hidden', 'true');
		probe.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;left:-9999px;background-color:rgb(0, 0, 0);color:rgb(255, 255, 255)';
		document.body.appendChild(probe);

		const check = () => {
			if (window.matchMedia('(forced-colors: active)').matches) return warn();
			if (
				html.hasAttribute('data-darkreader-mode') ||
				html.hasAttribute('data-darkreader-scheme') ||
				document.querySelector('meta[name="darkreader"], style.darkreader, [data-nighteye], #nighteyedefaultcss')
			) return warn();
			const probeStyle = getComputedStyle(probe);
			const bodyStyle = getComputedStyle(document.body);
			if (
				probeStyle.backgroundColor !== 'rgb(0, 0, 0)' ||
				probeStyle.color !== 'rgb(255, 255, 255)' ||
				bodyStyle.backgroundColor !== 'rgb(0, 0, 0)' ||
				(html.style.filter && html.style.filter !== 'none')
			) return warn();
		};
		check();
		window.matchMedia('(forced-colors: active)').addEventListener('change', check);
		let timer;
		const observer = new MutationObserver(() => {
			clearTimeout(timer);
			timer = setTimeout(check, 150);
		});
		observer.observe(html, { attributes: true, attributeFilter: ['style', 'class', 'data-darkreader-mode', 'data-darkreader-scheme'] });
		observer.observe(document.head, { childList: true });
	}

	// ------------------------------------------------------------ start

	function init() {
		render();
		ensureFooter();
		watchForcedTheme();
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();

	if (window.jQuery) {
		jQuery(window).on('action:ajaxify.end', () => {
			applyQuery();
			render();
			ensureFooter();
		});
	}
}());
