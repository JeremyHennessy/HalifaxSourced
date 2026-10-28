// A weather review may not send a source request until both its pending bytes
// and every directory binding leading to the exclusive journal are durable.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,resolve} from 'node:path';

async function syncDirectory(path) {
  // Unsupported directory/no-follow handles or fsync are errors, not permission
  // to weaken the pre-request barrier (including on non-POSIX filesystems).
  if(!Number.isInteger(constants.O_DIRECTORY)||!Number.isInteger(constants.O_NOFOLLOW))
    throw new Error('Weather journal requires directory fsync and no-follow support');
  const directory=await fs.open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try {await directory.sync();}
  finally {await directory.close();}
}

async function durableDirectoryChain(path) {
  const chain=[];
  for(let current=path;;current=dirname(current)){
    chain.unshift(current);
    if(dirname(current)===current)break;
  }
  for(const directory of chain){
    try {
      const entry=await fs.lstat(directory);
      if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error('Weather journal parent is not a real directory');
    }catch(error){
      if(error.code!=='ENOENT')throw error;
      // Nonrecursive: the parent has already passed its durability barrier.
      // A concurrent creator is still checked by the no-follow directory open.
      try {await fs.mkdir(directory,{mode:0o700});}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
    await syncDirectory(directory);
    const parent=dirname(directory);
    if(parent!==directory)await syncDirectory(parent);
  }
}

export async function openWeatherReviewJournal(path,pending) {
  const target=resolve(path),parent=dirname(target);
  // Also sync existing ancestors: they might remain after an earlier aborted
  // creation whose directory barrier failed. Existence alone is not durability.
  await durableDirectoryChain(parent);
  const journal=await fs.open(target,'wx');
  try {
    await journal.writeFile(JSON.stringify(pending)+'\n');
    await journal.sync();
    await syncDirectory(parent); // the newly created journal pathname
    return journal;
  }catch(error){
    // Never unlink on failure: an uncertain existing journal still blocks reuse.
    await journal.close().catch(()=>{});
    throw error;
  }
}
