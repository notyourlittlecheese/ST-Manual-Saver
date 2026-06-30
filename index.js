import {
    saveChatConditional,
    saveSettingsDebounced,
    eventSource,
    event_types,
    chat,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const MODULE_NAME = 'manual_saver';

const defaultSettings = Object.freeze({
    enabled: true,
});

function getSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = { ...defaultSettings };
    }

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwnProperty.call(extension_settings[MODULE_NAME], key)) {
            extension_settings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    return extension_settings[MODULE_NAME];
}

function saveSettings() {
    saveSettingsDebounced();
}

function renderSettingsHtml() {
    const settings = getSettings();

    return `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>手动保存</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="manual_saver_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                    启用插件
                </label>
                <small>
                    启用后，将拦截 SillyTavern 原本的空自动保存；仅在手动点击保存、用户发出新消息、AI生成完成后保存。
                </small>
            </div>
        </div>
    `;
}

let isManualSave = false;
let lastSavedChatLength = 0;
let eventSaveQueued = false;

async function triggerRealSave(reason) {
    const settings = getSettings();
    if (!settings.enabled) return;

    isManualSave = true;

    try {
        console.log(`[ST-Manual-Saver] Save triggered: ${reason}`);
        await saveChatConditional();
    } catch (error) {
        console.error('[ST-Manual-Saver] Error while trying to save:', error);
        isManualSave = false;

        if (window.toastr) {
            window.toastr.error(`聊天保存失败: ${error.message}`, 'ST-Manual-Saver');
        }
    }
}

function saveAfterChatChanged(reason) {
    const settings = getSettings();
    if (!settings.enabled) return;

    if (eventSaveQueued) return;
    eventSaveQueued = true;

    setTimeout(async () => {
        eventSaveQueued = false;

        if (!Array.isArray(chat)) return;

        if (chat.length === lastSavedChatLength) {
            console.log(`[ST-Manual-Saver] Skip save, chat length unchanged: ${reason}`);
            return;
        }

        lastSavedChatLength = chat.length;
        await triggerRealSave(reason);
    }, 500);
}

function addSaveButton() {
    if ($('#manual_save_button').length) return;

    let extensionsMenu = $('#extensionsMenu');

    if (!extensionsMenu.length) {
        const optionsMenu = $('#options');

        if (!optionsMenu.length) {
            console.warn('[ST-Manual-Saver] Menu not found. Cannot add save button.');
            return;
        }

        extensionsMenu = optionsMenu;
    }

    const saveButton = $(`
        <div id="manual_save_button" class="list-group-item flex-container flexGap5 interactable" title="保存聊天" tabindex="0">
            <div class="fa-fw fa-solid fa-floppy-disk extensionsMenuExtensionButton"></div>
            <span>保存聊天</span>
        </div>
    `);

    saveButton.on('click', async () => {
        await triggerRealSave('manual button');
    });

    extensionsMenu.append(saveButton);
}

function removeSaveButton() {
    $('#manual_save_button').remove();
}

function updateButtonState() {
    if (getSettings().enabled) {
        const buttonInterval = setInterval(() => {
            if ($('#extensionsMenu').length || $('#options').length) {
                addSaveButton();
                clearInterval(buttonInterval);
            }
        }, 500);
    } else {
        removeSaveButton();
    }
}

function bindSettingsEvents() {
    $(document).on('change', '#manual_saver_enabled', function () {
        getSettings().enabled = $(this).prop('checked');
        saveSettings();
        updateButtonState();
    });
}

console.log('[ST-Manual-Saver] Plugin loading and patching fetch...');

const originalFetch = window.fetch;

window.fetch = function (url, options) {
    const settings = getSettings();

    if (!settings.enabled) {
        return originalFetch.apply(this, arguments);
    }

    const urlString = url.toString();
    const isSaveRequest = urlString.includes('/api/chats/save') || urlString.includes('/api/chats/group/save');

    if (isSaveRequest) {
        if (isManualSave) {
            console.log('[ST-Manual-Saver] Allowing chat save request to:', urlString);
            isManualSave = false;

            return originalFetch.apply(this, arguments).then(response => {
                if (response.ok) {
                    if (window.toastr) window.toastr.success('聊天保存成功', 'ST-Manual-Saver');
                } else {
                    if (window.toastr) window.toastr.error(`聊天保存失败: ${response.statusText}`, 'ST-Manual-Saver');
                }

                return response;
            }).catch(error => {
                console.error('[ST-Manual-Saver] Save fetch error:', error);

                if (window.toastr) {
                    window.toastr.error(`聊天保存失败: ${error.message}`, 'ST-Manual-Saver');
                }

                throw error;
            });
        }

        console.log('[ST-Manual-Saver] Blocked automatic empty save request to:', urlString);

        return Promise.resolve(new Response(JSON.stringify({
            status: 'ok',
            message: 'Blocked by ST-Manual-Saver',
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
    }

    return originalFetch.apply(this, arguments);
};

console.log('[ST-Manual-Saver] Global fetch patched successfully.');

$(document).ready(function () {
    const extensionsSettings = $('#extensions_settings');

    if (extensionsSettings.length) {
        extensionsSettings.append(`
            <div id="manual_saver_settings">
                ${renderSettingsHtml()}
            </div>
        `);

        bindSettingsEvents();
    }

    if (Array.isArray(chat)) {
        lastSavedChatLength = chat.length;
    }

    eventSource.on(event_types.MESSAGE_SENT, () => saveAfterChatChanged('user message sent'));
    eventSource.on(event_types.GENERATION_ENDED, () => saveAfterChatChanged('generation ended'));

    updateButtonState();
});
