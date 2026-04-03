function getUrl(input) {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

globalThis.fetch = async (input) => {
  throw new Error(`Network access is disabled in this test environment: ${getUrl(input)}`);
};
