(function (window) {
  'use strict';
  // In-memory correlation for one lookup/challenge and its recovery attempts.
  // Nothing is stored in cookies/localStorage or tied to member identity.
  window.DPCJoinDiagnostics = function (component) {
    var episodeId = null, attempt = 0, stage = '', started = 0, failed = false;
    function emit(event, code, details, outcome) {
      try {
        var diagnostics = {
          component: component, stage: stage, episode_id: episodeId,
          attempt: Math.min(attempt, 100),
          elapsed_ms: Math.min(600000, Math.max(0, Math.round(performance.now() - started)))
        };
        details = details || {};
        if (['timeout', 'network', 'http', 'invalid_json', 'incomplete_tuple', 'configuration', 'rpc', 'script_timeout', 'script_error', 'widget_error', 'render_exception', 'unknown'].indexOf(details.failure_kind) !== -1) {
          diagnostics.failure_kind = details.failure_kind;
        }
        if (typeof details.provider_code === 'string' && /^\d{6}$/.test(details.provider_code)) diagnostics.provider_code = details.provider_code;
        if (typeof details.request_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(details.request_id)) diagnostics.request_id = details.request_id;
        if (outcome) diagnostics.outcome = outcome;
        if (window.DPCAnalytics) window.DPCAnalytics.track(event, {
          error_code: code || null,
          http_status: details && details.status,
          diagnostics: diagnostics
        });
      } catch (e) { /* Diagnostics must never interrupt consent or security. */ }
    }
    return {
      begin: function (nextStage) {
        if (!failed) {
          episodeId = null;
          try { episodeId = window.crypto.randomUUID(); } catch (e) {}
          attempt = 0;
        }
        attempt += 1;
        stage = nextStage;
        started = performance.now();
        if (failed) emit('join_recovery', null, null, 'retry_started');
      },
      failure: function (code, details) {
        failed = true;
        emit('join_error', code, details);
      },
      recovered: function () {
        if (failed) emit('join_recovery', null, null, 'recovered');
        failed = false;
      }
    };
  };
})(window);
