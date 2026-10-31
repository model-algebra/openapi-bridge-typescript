import type { Model, ModelBridge } from "model-algebra-common";
import type { OpenApiDocument } from "./openapi.js";
import { type OpenApiBridgeOptions } from "./OpenApiSetBridge.js";
/**
 * OpenAPI description of a CRUD API for one model, and the model back from such a description.
 * See OpenApiSetBridge for what the document holds; OBJECT fields describe the referenced model by name only.
 */
export declare class OpenApiBridge implements ModelBridge<Model, OpenApiDocument> {
    private readonly options;
    private readonly set;
    constructor(options?: OpenApiBridgeOptions);
    toTarget(model: Model): OpenApiDocument;
    /** Reads the one model the document describes. */
    toModel(document: OpenApiDocument): Model;
}
//# sourceMappingURL=OpenApiBridge.d.ts.map