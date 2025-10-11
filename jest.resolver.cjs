module.exports = (request, options) => {
  const defaultResolver = options.defaultResolver;
  if (request.endsWith('.js')) {
    const tsRequest = request.replace(/\.js$/, '.ts');
    try {
      return defaultResolver(tsRequest, options);
    } catch (err) {
      // ignore and fall back to default resolution
    }
  }
  return defaultResolver(request, options);
};
