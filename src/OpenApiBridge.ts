import type { Model, ModelBridge } from "model-algebra-common";
import { toModelData } from "model-algebra-typescript";
import type { OpenApiDocument } from "./openapi.js";
import { OpenApiSetBridge, type OpenApiBridgeOptions } from "./OpenApiSetBridge.js";

/**
 * OpenAPI description of a CRUD API for one model, and the model back from such a description.
 * See OpenApiSetBridge for what the document holds; OBJECT fields describe the referenced model by name only.
 */
export class OpenApiBridge implements ModelBridge<Model, OpenApiDocument> {
    private readonly set: OneModelBridge;

    constructor(private readonly options: OpenApiBridgeOptions = {}) {
        this.set = new OneModelBridge(options);
    }

    toTarget(model: Model): OpenApiDocument {
        return this.set.forModel(model);
    }

    /** Reads the one model the document describes. */
    toModel(document: OpenApiDocument): Model {
        const models = this.set.toModel(document);
        if (models.size !== 1)
            throw new Error(`OpenApiBridge.toModel() needs a document of exactly one model, found ${models.size}; use OpenApiSetBridge for several`);
        return models.models[0];
    }
}

class OneModelBridge extends OpenApiSetBridge {
    constructor(private readonly own: OpenApiBridgeOptions) {
        super(own);
    }

    forModel(model: Model): OpenApiDocument {
        const data = toModelData(model);
        return this.document([data], this.own.title ?? `${data.metadata.name} API`);
    }
}
