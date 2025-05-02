/* global jQuery, Handlebars, Sortable */
/* global game, loadTemplates, Application, FormApplication, Dialog */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api

import { Aspect, Tracker } from "./tracker.js";
import { RGBColor } from "./colors.js";
import Socket from "./socket.js";

/**
 * Parse handlebar templates included with the aspect tracker.
 * @returns {Promise<Array<Function>>} an array of functions used for rendering the templates
 */
async function preloadTemplates() {
  const templates = [
    "modules/fate-aspect-tracker/templates/aspect-list.hbs",
    "modules/fate-aspect-tracker/templates/aspect-item-form.hbs",
    "modules/fate-aspect-tracker/templates/aspect-drawing-settings.hbs",
    "modules/fate-aspect-tracker/templates/partial/aspect-item.hbs",
  ];

  Handlebars.registerHelper("tags", function(tag, options) {
    const tags = tag.split(',');
    const tagsAsHtml = tags.map(tag => options.fn(tag));
    return tagsAsHtml.join("\n");
  });

  Handlebars.registerHelper('hideAspect', function(hidden, GM, options) {
    if(!hidden || GM) {
      return options.fn(this);
    }
    return options.inverse(this);
  });

  Handlebars.registerHelper('canEdit', function(edit, GM, options) {
    if(edit && GM) {
      return options.fn(this);
    }
    return options.inverse(this);
  });

  return loadTemplates(templates);
}

export class AspectTrackerWindow extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "fate-aspect-tracker-app",
    position: {
      width: 400,
      height: 600,
    },
    window: {
      icon: "fas fa-books",
      title: "FateAspectTracker.aspecttrackerwindow.title",
      minimizable: true,
      resizable: true,
      controls : [
        {
          icon: 'fa-solid fa-palette',
          label: 'Settings',
          action: "showSettings",
          visible: true,
        },
        {
          icon: 'fa-solid fa-eye',
          label: "Show players",
          action: "showPlayer",
          visible: true,
        }
      ]
    },
    actions: {
      newAspect: AspectTrackerWindow.newAspect,
      showSettings: AspectTrackerWindow.showSettings,
      showPlayer: AspectTrackerWindow.showPlayer,
      aspectEdit: AspectTrackerWindow.aspectActionHandler,
      aspectCopy: AspectTrackerWindow.aspectActionHandler,
      aspectDelete: AspectTrackerWindow.aspectActionHandler,
      aspectToggle: AspectTrackerWindow.aspectActionHandler,
      aspectIncrease: AspectTrackerWindow.aspectActionHandler,
      aspectDecrease: AspectTrackerWindow.aspectActionHandler,
    }
  }

  static PARTS = {
    app: {
      template: "./modules/fate-aspect-tracker/templates/aspect-list.hbs"
    },
  }

  get title() {
    return game.i18n.localize(this.options.window.title);
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Move aspect item in item list
    const html = $(this.element);
    const listEl = html.find("#fate-aspect-tracker-list").get(0);
    if (listEl) {
      Sortable.create(listEl, {
        revertOnSpill: true,
        onEnd: async (evt) => {
          if (evt.oldIndex == evt.newIndex) return;

          if(game.user.isGM) {
            const tracker = Tracker.load();
            await tracker.moveAspect(evt.oldIndex, evt.newIndex);
          }
        },
        onSpill: async (evt) => {
          if(game.user.isGM) {
            const tracker = Tracker.load();
            await tracker.creatTextAspect(evt.oldIndex, evt.originalEvent.clientX, evt.originalEvent.clientY);
          }
        },
      });
    }

    // Aspect inline editing
    this.element.querySelectorAll("p.aspect-description").forEach(el => {
      el.addEventListener("click", async (e) => {
        const index = el.dataset.index;

        const tracker = Tracker.load();
        await tracker.toggleEditing(index);

        window.aspectTrackerWindow.render(true);
      })
    })

    this.element.querySelectorAll("p.edit-description").forEach(el => {
      el.addEventListener("keypress", async (e) => {
        if(e.which != 13) return;

        const index = el.dataset.index;
        const desc = e.target.value;

        const tracker = Tracker.load();
        let aspect = tracker.aspects[index];
        aspect.description = desc;

        await tracker.updateAspect(index, aspect);
        await tracker.toggleEditing(index);

        window.aspectTrackerWindow.render(true);
      })
    })

    // Tags are colored based on the aspect color
    this.element.querySelectorAll('#fate-aspect-tracker-list span.tag').forEach(tag => {
      const color = tag.getAttribute("data-color") || "#000000";

      const parsed = RGBColor.parse(color);
      const contrast = parsed.contrastColor();

      tag.style.backgroundColor = parsed.toCSS();
      tag.style.color = contrast.toCSS();
    })    
  }

  _prepareContext() {
    let data = {
      tracker: Tracker.load(),
      GM: game.user.isGM,
    }
    return data;
  }

  _canDragDrop() {
		return game.user.isGM;
	}

  async _onDrop(dragEvent) {
    const dragData = dragEvent.dataTransfer.getData("text/plain");
		const data = JSON.parse(dragData);

    if (data.type != "aspect") return;

    let tracker = Tracker.load();
    await tracker.addAspectFromData(data.name, data.tag, undefined, data.value);
	}

  static async newAspect() {
    new AspectForm(undefined, undefined).render(true);
  }

  static showPlayer() {
    if (!game.user.isGM) return;
    Socket.showTrackerToPlayers();
  }

  static showSettings() {
    if (!game.user.isGM) return;
    new AspectDrawingSettings().render(true);
  }

  static async aspectActionHandler(event, target) {
    const index = target.dataset.index;
    const action = target.dataset.action;

    const tracker = Tracker.load();
    switch (action) {
      case "aspectDelete":
        await tracker.deleteAspect(index);
        break;
      case "aspectIncrease":
        await tracker.increaseInvoke(index);
        break;
      case "aspectDecrease":
        await tracker.decreaseInvoke(index);
        break;
      case "aspectEdit":
        new AspectForm(tracker.aspects[index], index).render(true);
        break;
      case "aspectCopy":
        new AspectForm(tracker.aspects[index], undefined).render(true);
        break;
      case "aspectToggle":
        await tracker.toggleVisibility(index);
        break;
      default:
        return;
    }

    window.aspectTrackerWindow.render(true);
  }
}

class AspectForm extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fate-aspect-tracker-form",
    tag: "form",
    form: {
      handler: AspectForm.onSubmit,
      closeOnSubmit: true
    },
    position: {
      width: 400,
    },
    window: {
      icon: "fas fa-gear",
      contentClasses: ["standard-form"],
      title: "FateAspectTracker.aspectform.title"
    }
  }

  static PARTS = {
    form: {
      template: "./modules/fate-aspect-tracker/templates/aspect-item-form.hbs"
    },
    footer: {
      template: "templates/generic/form-footer.hbs",
    },
  }

  constructor(aspect, index) {
    super();

    this.aspect = aspect ?? new Aspect();
    this.index = index;
  }

  get title() {
    return game.i18n.localize(this.options.window.title);
  }

  _onRender(context, options) {
    super._onRender(context, options);
  }

  _prepareContext() {
    const label = this.index == undefined ? "FateAspectTracker.aspectform.createaspect": "FateAspectTracker.aspectform.updateaspect";

    return {
      index: this.index,
      aspect: this.aspect,
      buttons: [
        { type: "submit", icon: "fa-solid fa-save", label: label }
      ]
    };
  }

  static async onSubmit(_event, _form, formData) {
    const data = formData.object;
    const aspect = new Aspect(data.description, data.tag, data.color, data.invoke);

    aspect.globalScope = data.globalScope;

    const list = Tracker.load();
    if (data.index) {
      await list.updateAspect(data.index, aspect);
    } else {
      await list.appendAspect(aspect);
    }

    window.aspectTrackerWindow.render(true);
  }
}

class AspectDrawingSettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fate-aspect-drawing-settings",
    tag: "form",
    form: {
      handler: AspectDrawingSettings.onSubmit,
      closeOnSubmit: true
    },
    actions: {
      reset: AspectDrawingSettings.reset,
    },
    position: {
      width: 450,
    },
    window: {
      icon: "fas fa-gear",
      contentClasses: ["standard-form"],
      title: "FateAspectTracker.aspectdrawingsettings.title"
    }
  }

  static PARTS = {
    form: {
      template: "./modules/fate-aspect-tracker/templates/aspect-drawing-settings.hbs"
    },
    footer: {
      template: "templates/generic/form-footer.hbs",
    },
  }

  _onRender(context, options) {
    super._onRender(context, options);
  }

  _prepareContext() {
    return {
      fontFamilies:Object.keys(CONFIG.fontDefinitions), 
      fontFamily:game.settings.get("fate-aspect-tracker","AspectDrawingFontFamily"),
      fontSize:game.settings.get("fate-aspect-tracker","AspectDrawingFontSize"),
      fontDynamicColor:game.settings.get("fate-aspect-tracker","AspectDrawingFontDynamicColor"),
      fontColor:game.settings.get("fate-aspect-tracker","AspectDrawingFontColor"),
      fillColor:game.settings.get("fate-aspect-tracker","AspectDrawingFillColor"),
      fillOpacity:game.settings.get("fate-aspect-tracker","AspectDrawingFillOpacity"),
      borderWidth:game.settings.get("fate-aspect-tracker","AspectDrawingBorderWidth"),
      borderColor:game.settings.get("fate-aspect-tracker","AspectDrawingBorderColor"),
      borderOpacity:game.settings.get("fate-aspect-tracker","AspectDrawingBorderOpacity"),

      buttons: [
        { type: "button", action: "reset", icon: "fa-solid fa-undo", label: "FateAspectTracker.aspectdrawingsettings.reset" },
        { type: "submit", icon: "fa-solid fa-save", label: "FateAspectTracker.aspectdrawingsettings.save" }
      ]
    };
  }

  static async onSubmit(_event, _form, formData) {
    const data = formData.object;

    let fontFamily = data.font_family;
    let fontSize = data.font_size;
    if (fontSize != 0) fontSize = Math.min(256, Math.max(8, fontSize));
    let fontDynamicColor = data.font_dynamic_color;
    let fontColor = data.font_color;
    let fillColor = data.fill_color;
    let fillOpacity = data.fill_opacity;
    let borderWidth = data.border_width;
    let borderColor = data.border_color;
    let borderOpacity = data.border_opacity;

    await game.settings.set("fate-aspect-tracker","AspectDrawingFontFamily", fontFamily);
    await game.settings.set("fate-aspect-tracker","AspectDrawingFontSize", fontSize);
    await game.settings.set("fate-aspect-tracker","AspectDrawingFontDynamicColor", fontDynamicColor);
    await game.settings.set("fate-aspect-tracker","AspectDrawingFontColor", fontColor);
    await game.settings.set("fate-aspect-tracker","AspectDrawingFillColor", fillColor);
    await game.settings.set("fate-aspect-tracker","AspectDrawingFillOpacity", fillOpacity);
    await game.settings.set("fate-aspect-tracker","AspectDrawingBorderWidth", borderWidth);
    await game.settings.set("fate-aspect-tracker","AspectDrawingBorderColor", borderColor);
    await game.settings.set("fate-aspect-tracker","AspectDrawingBorderOpacity", borderOpacity);
  }

  static async reset() {
    await game.settings.set("fate-aspect-tracker","AspectDrawingFontFamily", undefined);
    await game.settings.set("fate-aspect-tracker","AspectDrawingFontSize", undefined);
    await game.settings.set("fate-aspect-tracker","AspectDrawingFontDynamicColor", undefined);
    await game.settings.set("fate-aspect-tracker","AspectDrawingFontColor", undefined);
    await game.settings.set("fate-aspect-tracker","AspectDrawingFillColor", undefined);
    await game.settings.set("fate-aspect-tracker","AspectDrawingFillOpacity", undefined);
    await game.settings.set("fate-aspect-tracker","AspectDrawingBorderWidth", undefined);
    await game.settings.set("fate-aspect-tracker","AspectDrawingBorderColor", undefined);
    await game.settings.set("fate-aspect-tracker","AspectDrawingBorderOpacity", undefined);
    this.close()
  }
}

/**
 * Setup the to-do list window. Adds a button to the journal directory.
 *
 * @param {JQuery} html is the rendered HTML provided by jQuery
 **/
function setupAspectTrackerWindow(html) {
  window.aspectTrackerWindow = new AspectTrackerWindow();
}

/**
 * Initialize relevant UI components:
 * - preloads relevant templates
 * - adds trigger button to journal
 *
 * @param {JQuery} html is the rendered HTML provided by jQuery
 **/
export async function initUiComponents(html) {
  await preloadTemplates();

  setupAspectTrackerWindow(html);
}
