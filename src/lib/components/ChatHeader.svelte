<script lang="ts">
	import type { ChatConversation } from '$lib/types';
	import { createEventDispatcher } from 'svelte';

	// Props (runes mode)
	let { recipient = null as ChatConversation | null, typingUsers = new Set<string>() } = $props();

	const dispatch = createEventDispatcher();
</script>

{#if recipient}
	<div class="p-3 md:p-4" style="background: var(--bg-primary); border-bottom: 1px solid rgba(255,255,255,0.06);">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3" style="animation: fadeIn 0.3s ease-out;">
				<!-- Avatar -->
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full font-semibold text-white"
					style="background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%);"
				>
					{(recipient.username?.[0] ?? '').toUpperCase()}
				</div>

				<div>
					<h3 class="text-base font-semibold md:text-lg" style="color: var(--text-primary);">{recipient.username}</h3>
					{#if typingUsers.has(recipient.userId)}
						<p class="text-sm" style="color: #6366f1; animation: fadeIn 0.2s ease-out;">typing...</p>
					{:else}
						<p class="text-sm" style="color: var(--text-tertiary);">Online</p>
					{/if}
				</div>
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-2">
				<button
					onclick={() => dispatch('call')}
					class="rounded-full p-2 transition-all"
					style="color: var(--text-secondary); background: transparent;"
					onmouseenter={(e) => {
						e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)';
						e.currentTarget.style.color = '#6366f1';
					}}
					onmouseleave={(e) => {
						e.currentTarget.style.background = 'transparent';
						e.currentTarget.style.color = 'var(--text-secondary)';
					}}
					title="Video call"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
						/>
					</svg>
				</button>
				<button
					onclick={() => dispatch('info')}
					class="rounded-full p-2 transition-all"
					style="color: var(--text-secondary); background: transparent;"
					onmouseenter={(e) => {
						e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)';
						e.currentTarget.style.color = '#6366f1';
					}}
					onmouseleave={(e) => {
						e.currentTarget.style.background = 'transparent';
						e.currentTarget.style.color = 'var(--text-secondary)';
					}}
					title="User info"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				</button>
			</div>
		</div>
	</div>
{:else}
	<div class="p-4" style="background: var(--bg-primary); border-bottom: 1px solid rgba(255,255,255,0.06);">
		<div class="text-center" style="color: var(--text-secondary);">Select a conversation</div>
	</div>
{/if}
