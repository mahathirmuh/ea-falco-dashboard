export const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Log request
  console.log(`📥 ${req.method} ${req.url}`, {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length')
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - start;
    
    console.log(`📤 ${req.method} ${req.url} - ${res.statusCode}`, {
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      statusCode: res.statusCode,
      contentLength: res.get('Content-Length')
    });
    
    originalEnd.call(this, chunk, encoding);
  };

  next();
};