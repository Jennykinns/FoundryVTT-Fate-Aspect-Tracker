export class Enrichers {
	static register() {
		Enrichers.#enrichAspects();
	}

	static #enrichAspects() {
		const enrichAspects = ([_text, aspect, invoke, tag]) => {
            if (!(aspect && invoke))
                return _text;

            return $(`<mark class="fat--aspect" draggable="true" tag="${tag || ""}">${aspect}-${invoke}</mark>`)[0];
		};
		CONFIG.TextEditor.enrichers.push({
			pattern: /\[([^\[\]{}]+)\-(\d+)(?:\/([^\[\]{}]+))?\]/gi,
			enricher: enrichAspects,
		});
	}
}
