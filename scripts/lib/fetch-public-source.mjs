import integrity from '../../source-integrity.js';
const host = integrity.sourceHost;
export async function fetchPublicSource(url, options, robotsAllows) {
  const originalHost=host(url);
  let target=url;
  for(let count=0;count<4;count++) {
    if(!integrity.safeSource(target) || host(target)!==originalHost) throw new Error('quarantined_cross_entity_redirect');
    if(!(await robotsAllows(target))) throw new Error('robots_disallow');
    const response=await fetch(target,{...options,redirect:'manual'});
    if(![301,302,303,307,308].includes(response.status))return response;
    const location=response.headers.get('location');
    if(!location)throw new Error('redirect_without_location');
    target=new URL(location,target).href;
  }
  throw new Error('redirect_limit');
}

// For existing source consumers without a robots callback, preserve their own
// access checks while enforcing quarantine and every redirect destination.
export function fetchGuardedSource(url, options = {}) {
  return fetchPublicSource(url, options, async () => true);
}
