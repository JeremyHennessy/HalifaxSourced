import integrity from '../../source-integrity.js';
import { sourceAccessState, SourceAccessHoldError } from './source-access-state.mjs';
const host = integrity.sourceHost;
const hostTails = new Map();
async function guardedHop(url, original, options, observer, attempted) {
  const state = sourceAccessState(), key = host(url), previous = hostTails.get(key) || Promise.resolve();
  const operation = previous.then(async () => {
    options?.signal?.throwIfAborted();
    const hold = state.access.find(url);
    if (hold) throw new SourceAccessHoldError(hold,url,attempted);
    observer.beforeRequest?.(url);
    const request = state.start(original,url), signal = options?.signal;
    let abortListener;
    const native = Promise.resolve().then(() => fetch(url,{...options,redirect:'manual'})).then(response => {
      const late = Boolean(signal?.aborted);
      const receipt = state.response(request,response,late);
      if (late) { observer.afterAbortedResponse?.(url,response,receipt); signal.throwIfAborted(); }
      observer.afterResponse?.(url,response,receipt);
      return response;
    }, error => { state.failed(request); throw error; });
    const aborted = new Promise((_,reject) => {
      if (!signal) return;
      abortListener = () => {
        // One event-loop turn drains an ordinary native abort rejection. This
        // grants no further HTTP operation and keeps this host locked meanwhile.
        const drain = new Promise(resolve => setImmediate(() => {
          if (!request.settled) state.suspend(request);
          resolve(); reject(signal.reason || new DOMException('Aborted','AbortError'));
        }));
        state.trackDrain(drain);
      };
      signal.addEventListener('abort',abortListener,{once:true});
      if (signal.aborted) abortListener();
    });
    try { return await Promise.race([native,aborted]); }
    finally { if (abortListener) signal.removeEventListener('abort',abortListener); }
  });
  hostTails.set(key,operation.catch(()=>{}));
  return operation;
}
export async function fetchPublicSource(url, options, robotsAllows, observer = {}) {
  const originalHost=host(url), original=String(url), state=sourceAccessState();
  let target=url, attempted=false;
  for(let count=0;count<4;count++) {
    options?.signal?.throwIfAborted();
    if(!integrity.safeSource(target) || host(target)!==originalHost) throw new Error('quarantined_cross_entity_redirect');
    const hold=state.access.find(target);
    if(hold) throw new SourceAccessHoldError(hold,target,attempted);
    if(!(await robotsAllows(target))) throw new Error('robots_disallow');
    options?.signal?.throwIfAborted();
    const response=await guardedHop(target,original,options,observer,attempted);
    attempted=true;
    if(![301,302,303,307,308].includes(response.status))return response;
    const location=response.headers.get('location');
    if(!location)throw new Error('redirect_without_location');
    target=new URL(location,target).href;
  }
  throw new Error('redirect_limit');
}

// Existing caller-specific robots checks remain authoritative in addition to the
// mandatory committed-access and every-hop quarantine/redirect gates.
export function fetchGuardedSource(url, options = {}, allows = async () => true, observer = {}) {
  return fetchPublicSource(url, options, allows, observer);
}

// AbortSignal.timeout alone is unreferenced in Node and cannot settle every
// stalled body/cancel operation. Keep a bounded timer alive for the complete
// request operation, and reject even if the underlying promise ignores abort.
export async function withSourceDeadline(operation, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException('Source operation deadline exceeded', 'TimeoutError');
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]); }
  finally { clearTimeout(timer); }
}
