/**
 * GET /metrics — Prometheus text exposition format.
 *
 * This endpoint is only reachable within the Docker network.
 * nginx blocks all public requests with `location = /metrics { return 403; }`.
 */
import { getMetrics, getContentType } from '$lib/server/metrics'
import type { RequestHandler } from '@sveltejs/kit'
import { error } from '@sveltejs/kit'

export const GET: RequestHandler = async () => {
	try {
		const body = await getMetrics()
		return new Response(body, {
			status: 200,
			headers: { 'Content-Type': getContentType() }
		})
	} catch (err) {
		console.error('[frontend] Failed to collect metrics:', err)
		throw error(500, 'metrics collection failed')
	}
}
