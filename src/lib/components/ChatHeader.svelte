<script lang="ts">
	import type { ChatConversation } from '$lib/types';
	import { createEventDispatcher } from 'svelte';

	export let recipient: ChatConversation | null = null;
	export let typingUsers: Set<string> = new Set();

	const dispatch = createEventDispatcher();
</script>

{#if recipient}
	<div class="border-b border-gray-200 bg-white p-3 md:p-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<!-- Avatar -->
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-blue-400 to-purple-500 font-semibold text-white"
				>
					{(recipient.username?.[0] ?? '').toUpperCase()}
				</div>

				<div>
					<h3 class="text-base font-semibold text-gray-900 md:text-lg">{recipient.username}</h3>
					{#if typingUsers.has(recipient.userId)}
						<p class="text-sm text-green-600">typing...</p>
					{:else}
						<p class="text-sm text-gray-500">Online</p>
					{/if}
				</div>
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-2">
				<button
					onclick={() => dispatch('call')}
					class="rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
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
					class="rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
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
	<div class="border-b border-gray-200 bg-white p-4">
		<div class="text-center text-gray-500">Select a conversation</div>
	</div>
{/if}
