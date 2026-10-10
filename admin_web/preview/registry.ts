/** Where handler files register what the preview answers for server functions and edge functions. */
type Row = Record<string, any>;
export interface Ctx { as: 'company' | 'platform'; tables: Record<string, Row[]> }
export type RpcHandler = (args: Row, ctx: Ctx) => any;
export type FnHandler = (body: Row, ctx: Ctx) => any;
export const rpcs: Record<string, RpcHandler> = {};
export const fns: Record<string, FnHandler> = {};
export const registerRpc = (map: Record<string, RpcHandler>) => { Object.assign(rpcs, map); };
export const registerFunctions = (map: Record<string, FnHandler>) => { Object.assign(fns, map); };
