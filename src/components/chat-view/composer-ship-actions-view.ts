import { html, type TemplateResult } from "lit";

interface RenderComposerShipActionsParams {
	disabled: boolean;
	shipping: boolean;
	onPreview: () => void | Promise<void>;
	onShip: () => void | Promise<void>;
}

export function renderComposerShipActionsView({
	disabled,
	shipping,
	onPreview,
	onShip,
}: RenderComposerShipActionsParams): TemplateResult {
	return html`
		<div class="composer-ship-actions">
			<button
				class="composer-preview-btn"
				type="button"
				?disabled=${disabled}
				@click=${() => {
					if (disabled) return;
					void onPreview();
				}}
			>
				Preview
			</button>
			<button
				class="composer-ship-btn"
				type="button"
				?disabled=${disabled || shipping}
				@click=${() => {
					if (disabled || shipping) return;
					void onShip();
				}}
			>
				${shipping ? "Shipping…" : "Ship"}
			</button>
		</div>
	`;
}
