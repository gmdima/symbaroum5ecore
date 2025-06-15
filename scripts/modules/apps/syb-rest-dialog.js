import { Resting } from '../resting.js';
import { COMMON } from '../../common.js';

export class SybRestDialog extends Dialog {
	constructor({ actor, type }, /*{newDay=false, autoHD=false, autoHDThreshold=3} = {},*/ dialogData = {}, options = {}) {
		super(dialogData, options);

		/**
		 * Store a reference to the Actor entity which is resting
		 * @type {Actor5e}
		 */
		this.actor = actor;

		/**
		 * Track the most recently used HD denomination for re-rendering the form
		 * @type {string}
		 */
		this._denom = null;

		this.type = type;

		/* store our various rest options */
		//this.options = {newDay, autoHD, autoHDThreshold};
	}

	/* -------------------------------------------- */

	/** @override */
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			template: `${COMMON.DATA.path}/templates/apps/rest.html`,
			classes: ['dnd5e', 'dialog', 'syb5e'],
		});
	}

	/* -------------------------------------------- */

	/** @override */
	activateListeners(html) {
		super.activateListeners(html);
		let healHp = html.find('#roll-hd');
		healHp.click(this._onRollHitDieForHealing.bind(this));

		let redCorr = html.find('#heal-corr');
		redCorr.click(this._onReduceCorruption.bind(this));
	}

	/* -------------------------------------------- */

	/** @override */
	getData() {
		const context = {
		    user: game.user,
		    actor: this.actor, // Provide the actor document to the template
		    system: this.actor.system // Provide system data directly
		}; // Basic context, similar to what Dialog.getData() might start with.
		const actorSystem = this.actor.system;

		// Prepare Hit Dice data (mimicking dnd5e ShortRestDialog's logic)
		context.availableHD = {};
		let canRoll = false;
		let defaultDenom = this._denom; // User's last selected denomination

		// Iterate over actor's classes to find available hit dice
		if (this.actor.classes) {
		    for (let [key, cls] of Object.entries(this.actor.classes)) {
		        if (!cls || !cls.system) continue; // Ensure class and system data exist
		        const d = cls.system;
		        if (!d.hitDice) continue;
		        const available = (d.levels || 0) - (d.hitDiceUsed || 0);
		        context.availableHD[d.hitDice] = Math.max(0, available);
		        if (available > 0) {
		            canRoll = true;
		            if (!defaultDenom) defaultDenom = d.hitDice;
		        }
		    }
		}
		context.canRoll = canRoll;
		context.denomination = defaultDenom || "d6"; // Fallback denomination if none available/selected

		// --- SybRestDialog specific data logic ---
		const restTypes = game.syb5e.CONFIG.REST_TYPES;
		context.restHint = {
			[restTypes.short]: 'SYB5E.Rest.ShortHint',
			[restTypes.long]: 'SYB5E.Rest.LongHint',
			[restTypes.extended]: 'SYB5E.Rest.ExtendedHint',
		}[this.type];

		context.isExtended = this.type === restTypes.extended;
		context.isShort = this.type === restTypes.short;
		context.promptNewDay = this.type !== restTypes.short;


		const gain = Resting._restHpGain(this.actor, this.type);
		const corruption = this.actor.corruption; // Assuming actor.corruption is correctly populated
		const corrRecovery = Resting._getCorruptionRecovery(this.actor, this.type);

		context.preview = {
			hp: (actorSystem.attributes.hp.value || 0) + gain,
			maxHp: actorSystem.attributes.hp.max || 0,
			tempCorr: Math.max((corruption?.temp || 0) - corrRecovery, 0),
			maxCorr: corruption?.max || 0,
		};

		context.preview.totalCorr = context.preview.tempCorr + (corruption?.permanent || 0);
		context.preview.hp = Math.min(context.preview.hp, context.preview.maxHp);

		// Pass config for localization of HD denominations if needed in template
		context.config = { hitDiceTypes: CONFIG.DND5E.hitDiceTypes };


		return context;
	}

	/* -------------------------------------------- */
	async _onRollHitDieForHealing(event) {
	    event.preventDefault();
	    const denomination = event.currentTarget.form.hd.value;
	    if (!denomination) return; // No denomination selected

	    this._denom = denomination; // Store for re-rendering

	    // Call the actor's rollHitDie method
	    // This method should handle spending the HD, rolling, applying healing, and sending a chat message.
	    await this.actor.rollHitDie(denomination, { suppressMessage: false });

	    // Re-render the dialog to update available HD and HP
	    this.render();
	}

	/* -------------------------------------------- */

	async _onReduceCorruption(event) {
		event.preventDefault();
		const button = event.currentTarget;
		this._denom = button.form.hd.value; // Ensure a hit die is selected for corruption reduction
		if (!this._denom) {
		    ui.notifications.warn(game.i18n.localize("SYB5E.Notifications.NoHitDieSelectedForCorruption"));
		    return;
		}
		// Check if actor has available HD of the selected type for corruption reduction
		const classWithDenom = Object.values(this.actor.classes).find(cls => cls.system.hitDice === this._denom);
		if (!classWithDenom || (classWithDenom.system.levels - classWithDenom.system.hitDiceUsed <= 0)) {
		    ui.notifications.warn(game.i18n.format("SYB5E.Notifications.NoHitDiceRemaining", {denomination: this._denom}));
		    return;
		}

		await Resting.corruptionHeal(this.actor, this.actor.system.attributes.prof);
		// Resting.expendHitDie was intended to manually mark an HD as used.
		// If rollHitDie (or a similar new method) is used, it might already do this.
		// For now, assuming Resting.expendHitDie is the Symbaroum way to spend HD for corruption.
		await Resting.expendHitDie(this.actor, this._denom);
		this.render();
	}

	/* -------------------------------------------- */

	static _generateDialogData(actor, restType, resolve, reject) {
		/* default data common to most rest types */
		let data = {
			title: '',
			buttons: {
				rest: {
					icon: '<i class="fas fa-bed"></i>',
					label: game.i18n.localize('DND5E.Rest'),
					callback: (html) => {
						const newDay = html.find('input[name="newDay"]')[0].checked;
						resolve(newDay);
					},
				},
				cancel: {
					icon: '<i class="fas fa-times"></i>',
					label: game.i18n.localize('Cancel'),
					callback: () => reject('cancelled'),
				},
			},
			default: 'rest',
			close: () => reject('cancelled'),
		};

		/* modify the stock data with rest specific information */
		switch (restType) {
			case game.syb5e.CONFIG.REST_TYPES.short:
				data.title = `${COMMON.localize('DND5E.ShortRest')}: ${actor.name}`;

				/* this is the only rest that wont cause a new day */
				data.buttons.rest.callback = (/*html*/) => {
					const newDay = false;
					resolve(newDay);
				};

				break;
			case game.syb5e.CONFIG.REST_TYPES.long:
				data.title = `${COMMON.localize('DND5E.LongRest')}: ${actor.name}`;
				break;
			case game.syb5e.CONFIG.REST_TYPES.extended:
				data.title = `${COMMON.localize('SYB5E.Rest.Extended')}: ${actor.name}`;
				break;
		}

		return data;
	}

	/* -------------------------------------------- */

	static async restDialog({ actor, type }) {
		return new Promise((resolve, reject) => {
			/* use an IFFE such that it can access resolve and reject */
			const dialogData = SybRestDialog._generateDialogData(actor, type, resolve, reject);

			new SybRestDialog({ actor, type }, dialogData).render(true);
		});
	}
}
