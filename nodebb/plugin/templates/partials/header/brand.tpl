<!-- Closet Republic header (replaces Harmony's partials/header/brand.tpl). -->
<script>
	// Apply nature mode before the page paints: ?nature= in the address first, then the saved
	// choice, otherwise on. public/closet-republic.js does the rest.
	(function () {
		var on = true;
		var m = document.cookie.match(/(?:^|; )cr_nature=([01])/);
		if (m) { on = m[1] === '1'; }
		var q = new URLSearchParams(window.location.search);
		['nature', 'paradoy', 'parody'].forEach(function (n) {
			var v = (q.get(n) || '').toLowerCase();
			if (['true', '1', 'on', 'yes'].indexOf(v) !== -1) { on = true; }
			if (['false', '0', 'off', 'no'].indexOf(v) !== -1) { on = false; }
		});
		document.documentElement.setAttribute('data-nature', on ? 'on' : 'off');
	}());
</script>
<header class="container-lg px-md-4 cr-header">
	<div class="cr-header__inner">
		<a class="cr-brand" href="{relative_path}/" aria-label="Closet Republic Forum, home">
			<svg class="cr-mark" viewBox="0 0 160 160" width="40" height="40" aria-hidden="true" focusable="false">
				<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="10">
					<path d="M138.38,150H21.62c-6.42,0-11.62-5.2-11.62-11.62V21.62c0-6.42,5.2-11.62,11.62-11.62h116.75c6.42,0,11.62,5.2,11.62,11.62v116.75c0,6.42-5.2,11.62-11.62,11.62Z" />
					<path d="M80,10c.25,18.19-.25,121.3,0,140" />
					<path d="M93.9,68.63c0,7.08.51,15.67.51,26.28" />
					<path d="M66.1,68.63v26.28" />
				</g>
			</svg>
			<span>Closet<br />Republic<span class="cr-brand__forum">Forum</span></span>
		</a>
		<nav aria-label="Closet Republic">
			<ul class="cr-header__links">
				<li><a href="{config.closetRepublic.siteUrl}">Main site</a></li>
				<li><a href="{config.closetRepublic.siteUrl}/constitution">Constitution</a></li>
				<li><a href="{config.closetRepublic.siteUrl}/guidelines">Guidelines</a></li>
			</ul>
		</nav>
		<button type="button" role="switch" aria-checked="true" class="cr-nature-toggle" component="closet-republic/nature-toggle" title="Toggle nature mode (or swipe sideways)" data-no-swipe>
			<span class="cr-nature-toggle__track" aria-hidden="true"><span class="cr-nature-toggle__thumb"></span></span>
			<span class="cr-nature-toggle__label">Nature</span>
		</button>
		{{{ if widgets.brand-header.length }}}
		<div data-widget-area="brand-header" class="d-flex gap-2 align-items-center">
			{{{each widgets.brand-header}}}
			{{./html}}
			{{{end}}}
		</div>
		{{{ end }}}
	</div>
	<p class="cr-sr-only" id="cr-visual-mode-description"></p>
	<p class="cr-sr-only" aria-live="polite" component="closet-republic/announce"></p>
</header>
