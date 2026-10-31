import { toModelData } from "model-algebra-typescript";
import { OpenApiSetBridge } from "./OpenApiSetBridge.js";
/**
 * OpenAPI description of a CRUD API for one model, and the model back from such a description.
 * See OpenApiSetBridge for what the document holds; OBJECT fields describe the referenced model by name only.
 */
export class OpenApiBridge {
    options;
    set;
    constructor(options = {}) {
        this.options = options;
        this.set = new OneModelBridge(options);
    }
    toTarget(model) {
        return this.set.forModel(model);
    }
    /** Reads the one model the document describes. */
    toModel(document) {
        const models = this.set.toModel(document);
        if (models.size !== 1)
            throw new Error(`OpenApiBridge.toModel() needs a document of exactly one model, found ${models.size}; use OpenApiSetBridge for several`);
        return models.models[0];
    }
}
class OneModelBridge extends OpenApiSetBridge {
    own;
    constructor(own) {
        super(own);
        this.own = own;
    }
    forModel(model) {
        const data = toModelData(model);
        return this.document([data], this.own.title ?? `${data.metadata.name} API`);
    }
}
//# sourceMappingURL=OpenApiBridge.js.map