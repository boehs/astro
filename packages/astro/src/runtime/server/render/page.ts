import type { RouteData, SSRResult } from '../../../@types/astro.js';
import { renderComponentToString, type NonAstroPageComponent } from './component.js';
import type { AstroComponentFactory } from './index.js';

import { isAstroComponentFactory } from './astro/index.js';
import { renderToReadableStream, renderToString, renderToAsyncIterable } from './astro/render.js';
import { encoder } from './common.js';
import { isNode } from './util.js';

export async function renderPage(
	result: SSRResult,
	componentFactory: AstroComponentFactory | NonAstroPageComponent,
	props: any,
	children: any,
	streaming: boolean,
	route?: RouteData
): Promise<Response> {
	if (!isAstroComponentFactory(componentFactory)) {
		result._metadata.headInTree =
			result.componentMetadata.get((componentFactory as any).moduleId)?.containsHead ?? false;

		const pageProps: Record<string, any> = { ...(props ?? {}), 'server:root': true };

		const str = await renderComponentToString(
			result,
			componentFactory.name,
			componentFactory,
			pageProps,
			{},
			true,
			route
		);

		const bytes = encoder.encode(str);

		return new Response(bytes, {
			headers: new Headers([
				['Content-Type', 'text/html; charset=utf-8'],
				['Content-Length', bytes.byteLength.toString()],
			]),
		});
	}

	// Mark if this page component contains a <head> within its tree. If it does
	// We avoid implicit head injection entirely.
	result._metadata.headInTree =
		result.componentMetadata.get(componentFactory.moduleId!)?.containsHead ?? false;

	let body: BodyInit | Response;
	if (streaming) {
		if (isNode) {
			const nodeBody = await renderToAsyncIterable(
				result,
				componentFactory,
				props,
				children,
				true,
				route
			);
			// Node.js allows passing in an AsyncIterable to the Response constructor.
			// This is non-standard so using `any` here to preserve types everywhere else.
			body = nodeBody as any;
		} else {
			body = await renderToReadableStream(result, componentFactory, props, children, true, route);
		}
	} else {
		body = await renderToString(result, componentFactory, props, children, true, route);
	}

	// If the Astro component returns a Response on init, return that response
	if (body instanceof Response) return body;

	// Create final response from body
	const init = result.response;
	const headers = new Headers(init.headers);
	// For non-streaming, convert string to byte array to calculate Content-Length
	if (!streaming && typeof body === 'string') {
		body = encoder.encode(body);
		headers.set('Content-Length', body.byteLength.toString());
	}
	// TODO: Revisit if user should manually set charset by themselves in Astro 4
	// This code preserves the existing behaviour for markdown pages since Astro 2
	if (route?.component.endsWith('.md')) {
		headers.set('Content-Type', 'text/html; charset=utf-8');
	}
	const response = new Response(body, { ...init, headers });
	return response;
}
