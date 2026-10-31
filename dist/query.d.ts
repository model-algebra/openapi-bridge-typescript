import type { ModelData } from "model-algebra-typescript";
import { type RefResolver } from "./schemas.js";
/** The sort parameter, if records can be sorted. */
export declare function sortParameter(model: ModelData): Record<string, any> | undefined;
/** Sort and filter parameters of the list operation of the model. */
export declare function queryParameters(model: ModelData, resolve: RefResolver): Record<string, any>[];
//# sourceMappingURL=query.d.ts.map