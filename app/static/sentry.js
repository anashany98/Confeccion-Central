(function(){
  if(!window.APP_CONFIG||!window.APP_CONFIG.sentryDsn)return;
  var s=document.createElement('script');
  s.src='https://browser.sentry-cdn.com/8.45.0/bundle.tracing.min.js';
  s.crossOrigin='anonymous';
  s.onload=function(){
    window.Sentry&&Sentry.init({
      dsn:window.APP_CONFIG.sentryDsn,
      environment:window.APP_CONFIG.environment||'production',
      release:window.APP_CONFIG.version?('confeccion-central@'+window.APP_CONFIG.version):undefined,
      tracesSampleRate:0,
      sendDefaultPii:false,
      beforeSend:function(event){
        if(!event.exception)return event;
        var msg=(event.exception.values&&event.exception.values[0]&&event.exception.values[0].value)||'';
        if(msg.indexOf('ResizeObserver')>=0)return null;
        if(msg.indexOf('NetworkError when attempting')>=0)return null;
        if(msg.indexOf('Loading chunk')>=0)return null;
        return event;
      }
    });
    window.addEventListener('error',function(e){if(window.Sentry)Sentry.captureException(e.error||e.message);});
    window.addEventListener('unhandledrejection',function(e){if(window.Sentry)Sentry.captureException(e.reason);});
  };
  document.head.appendChild(s);
})();
