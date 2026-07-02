<script lang="ts">
	// The signature motif: a wax seal with an embossed envelope.
	// Theme-aware — wax stops read from CSS vars, so it warms up in dark mode.
	let { size = 56, title = 'End-to-end encrypted' }: { size?: number; title?: string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 64 64"
	role="img"
	aria-label={title}
	xmlns="http://www.w3.org/2000/svg"
	class="seal"
>
	<defs>
		<radialGradient id="seal-wax" cx="36%" cy="30%" r="80%">
			<stop offset="0%" style="stop-color: var(--seal-highlight)" />
			<stop offset="52%" style="stop-color: var(--seal)" />
			<stop offset="100%" style="stop-color: var(--seal-deep)" />
		</radialGradient>
	</defs>
	<circle cx="32" cy="32" r="27" fill="url(#seal-wax)" />
	<!-- pressed-edge emboss -->
	<circle
		cx="32"
		cy="32"
		r="27"
		fill="none"
		stroke="#000"
		stroke-opacity="0.26"
		stroke-width="1.5"
	/>
	<circle
		cx="32"
		cy="32"
		r="20.5"
		fill="none"
		stroke="#000"
		stroke-opacity="0.2"
		stroke-width="1"
	/>
	<!-- embossed envelope -->
	<g
		stroke="var(--accent-contrast)"
		stroke-opacity="0.9"
		stroke-width="2.3"
		fill="none"
		stroke-linejoin="round"
		stroke-linecap="round"
	>
		<rect x="20" y="24.5" width="24" height="15" rx="2" />
		<path d="M20.5 26 L32 33.5 L43.5 26" />
	</g>
</svg>

<style>
	.seal {
		display: block;
		filter: drop-shadow(0 6px 16px var(--accent-soft));
	}
</style>
