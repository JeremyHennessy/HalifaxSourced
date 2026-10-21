import { promotionLane, reservedBranchNames } from './lib/preview-coordinator.mjs';
const [mode,artifact]=process.argv.slice(2);
if(mode==='target') console.log(promotionLane(artifact).branch);
else if(mode==='peers') console.log(reservedBranchNames(artifact).join('\n'));
else throw new Error('Expected target or peers plus an allowlisted artifact');
