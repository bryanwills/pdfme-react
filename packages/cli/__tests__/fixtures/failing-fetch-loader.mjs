function getUrl(input) {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

const originalFetch = globalThis.fetch.bind(globalThis);
const NETWORK_ERROR_URL = 'https://fonts.example.com/network-error.ttf';
const HTTP_503_URL = 'https://fonts.example.com/http-503.ttf';
const OVERSIZED_URL = 'https://fonts.example.com/oversized.ttf';
const OVERSIZED_STREAM_URL = 'https://fonts.example.com/oversized-stream.ttf';

globalThis.fetch = async (input, init) => {
  const url = getUrl(input);

  if (url === NETWORK_ERROR_URL) {
    throw new Error(`Synthetic network failure for ${url}`);
  }

  if (url === HTTP_503_URL) {
    return new Response('remote font unavailable', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
  }

  if (url === OVERSIZED_URL) {
    return new Response('tiny-body', {
      status: 200,
      headers: {
        'content-type': 'font/ttf',
        'content-length': String(40 * 1024 * 1024),
      },
    });
  }

  if (url === OVERSIZED_STREAM_URL) {
    const chunkSize = 17 * 1024 * 1024;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(chunkSize));
        controller.enqueue(new Uint8Array(chunkSize));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'font/ttf' },
    });
  }

  return originalFetch(input, init);
};
