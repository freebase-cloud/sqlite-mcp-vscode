import {readFile} from 'node:fs/promises';
import {MCP} from './mcp.mjs';
import {engines} from './engines.mjs';
import {boundedQuery} from './read.mjs';
const meta=JSON.parse(await readFile(new URL('../example.json',import.meta.url),'utf8'));
const def=engines.find(x=>x.engine===meta.engine);
async function main() {
  if (!process.argv.includes('--live')) {
    console.log(`Preview only. Configure a ${meta.engine} MCP connection in website Settings → MCP, then run npm run mcp -- --live.`);
    return;
  }
  const connection=process.env.FREEBASE_MCP_CONNECTION;
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(connection || '')) throw new Error('Set the exact FREEBASE_MCP_CONNECTION name from the website');
  const client=new MCP(process.env.FREEBASE_URL,process.env.FREEBASE_MCP_TOKEN);
  try {
    await client.initialize();
    const tools=await client.tools();
    const list=tools.find(t=>t.name===`${connection}_list_tables`);
    if (!list || !list.description?.includes(`(${def.engine})`) && !list.description?.includes(` ${def.engine} database`)) throw new Error('Connection engine did not match the selected example');
    console.log(JSON.stringify(await client.read(list.name,{}),null,2));
    if (process.argv.includes('--read')) {
      const table=process.env.FREEBASE_TABLE;
      const query=boundedQuery(def,table);
      const name=`${connection}_${def.dialect==='redis' ? 'get' : 'query'}`;
      const tool=tools.find(t=>t.name===name);
      const field=def.dialect==='redis' ? 'key' : 'query';
      if (!tool?.inputSchema?.properties?.[field]) throw new Error('Expected read tool schema was not advertised');
      console.log(JSON.stringify(await client.read(name,def.dialect==='redis' ? {key:table} : {query}),null,2));
    }
  } finally { await client.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
