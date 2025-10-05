// ==UserScript==
// @name         ImmersionKit → Anki
// @namespace    immersionkit_to_anki
// @version      1.0.0
// @description  Add example images and audio from ImmersionKit's dictionary pages to your latest Anki note via AnkiConnect.  The script creates two buttons on each dictionary page – one for adding the first example image and one for adding the first example audio – and uploads the media to the most recently created card.  Field names for image and audio are configurable at the top of the script.  Requires Anki with the AnkiConnect add‑on running.
// @match        https://www.immersionkit.com/dictionary*
// @connect      apiv2.immersionkit.com
// @connect      us-southeast-1.linodeobjects.com
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// ==/UserScript==

/*
 * ImmersionKit → Anki
 *
 * This userscript fetches the first example for the current dictionary keyword
 * using ImmersionKit’s public API and then uploads the image or audio from
 * that example to your latest Anki note via AnkiConnect.  Instead of
 * scraping the on‑page “Image” and “Sound” buttons – which can change
 * depending on site updates – the script talks directly to
 * `apiv2.immersionkit.com/search` to retrieve a structured JSON payload.  Each
 * example contains fields such as `image`, `sound`, `media`, and `title`.  The
 * full media URL is constructed following the same pattern used in the
 * official ImmersionKit example code (see lines 1166‑1172 of the JPDB
 * Immersion Kit Examples userscript【744911798459521†L1166-L1172】).  A sample API
 * response shows that each example entry includes `image` and `sound`
 * filenames along with the anime title【392132226126358†L10-L17】.  We compute the
 * complete media URL using these values and the standard Linode object store
 * prefix.
 *
 * Field names for image and audio attachments are defined below.  If your
 * note template uses different field names, update IMAGE_FIELD_NAME and
 * AUDIO_FIELD_NAME accordingly.  The script assumes that the most recent
 * card added in the last 24 hours is the target; you can adjust the
 * AnkiConnect query in the `addMediaToAnki` function if you prefer another
 * card selection strategy.
 */

(function () {
    "use strict";
  
    /**
     * Configuration.  Adjust these values to match your environment.
     */
    const CONFIG = {
      // URL of your AnkiConnect server.  Defaults to the local Anki instance.
      ANKI_CONNECT_URL: "http://127.0.0.1:8765",
      // Optional AnkiConnect API key; set it if you've configured one in AnkiConnect
      ANKI_CONNECT_KEY: null,
      // Name of the note field that should receive picture media.  Change this
      // if your card template uses a different field.
      IMAGE_FIELD_NAME: "Picture",
      // Name of the note field that should receive audio media.  Change this
      // if your card template uses a different field.
      AUDIO_FIELD_NAME: "SentenceAudio",
      // Index of the example to use from the ImmersionKit API response (0 = first).
      EXAMPLE_INDEX: 0,
    };
  
    /**
     * Issue a call to AnkiConnect.  Returns a Promise that resolves with
     * AnkiConnect’s `result` or rejects with an Error containing the API’s
     * error string or a connection message.
     *
     * @param {string} action The AnkiConnect action name.
     * @param {Object} params Parameters for the action.
     * @returns {Promise<any>} A Promise resolving to the result of the call.
     */
    function invokeAnkiConnect(action, params = {}) {
      const payload = {
        action,
        version: 6,
        params,
      };
      if (CONFIG.ANKI_CONNECT_KEY) payload.key = CONFIG.ANKI_CONNECT_KEY;
      const endpoints = [
        CONFIG.ANKI_CONNECT_URL,
        "http://localhost:8765",
      ];
      return new Promise((resolve, reject) => {
        let tried = 0;
        function tryNext() {
          if (tried >= endpoints.length) {
            reject(
              new Error("Failed to connect to AnkiConnect. Is Anki running?"),
            );
            return;
          }
          const url = endpoints[tried++];
          GM_xmlhttpRequest({
            method: "POST",
            url,
            data: JSON.stringify(payload),
            headers: { "Content-Type": "application/json" },
            onload: (res) => {
              try {
                const data = JSON.parse(res.responseText);
                if (data && data.error) {
                  reject(new Error(data.error));
                } else if (data && "result" in data) {
                  resolve(data.result);
                } else {
                  reject(new Error("Unexpected AnkiConnect response"));
                }
              } catch (e) {
                reject(new Error("Failed to parse AnkiConnect response" + e));
              }
            },
            onerror: tryNext,
          });
        }
        tryNext();
      });
    }
  
    /**
     * Fetch example data from ImmersionKit’s API for a given keyword.
     *
     * @param {string} keyword The word you are looking up on the dictionary page.
     * @returns {Promise<Array<Object>>} A Promise resolving to an array of examples.
     */
    function fetchExamples(keyword) {
      return new Promise((resolve, reject) => {
        const url = `https://apiv2.immersionkit.com/search?q=${encodeURIComponent(keyword)}`;
        GM_xmlhttpRequest({
          method: "GET",
          url,
          onload: (res) => {
            try {
              const data = JSON.parse(res.responseText);
              if (
                data &&
                Array.isArray(data.examples) &&
                data.examples.length > 0
              ) {
                resolve(data.examples);
              } else {
                reject(new Error("No examples returned from ImmersionKit API"));
              }
            } catch (e) {
              reject(new Error("Failed to parse ImmersionKit API response" + e));
            }
          },
          onerror: () => reject(new Error("Failed to request ImmersionKit API")),
        });
      });
    }
  
    /**
     * Build the full image or audio URL from an example record.  ImmersionKit
     * stores its media on a Linode object store.  Each example contains
     * `media` (the deck’s internal name), `title` (the anime title), and
     * `image` or `sound` file names.  We assemble the final URL following
     * the pattern documented in the official JPDB userscript【744911798459521†L1166-L1172】.
     *
     * @param {Object} example The example object returned by the API.
     * @param {'picture'|'audio'} mediaType Which media to build ('picture' => image, 'audio' => sound).
     * @returns {string} A fully qualified URL pointing to the media file.
     */
    // removed unused buildMediaUrl in favor of buildMediaTargets

    /**
     * Build both direct object-store URL and API fallback URL with filename.
     * @param {Object} example
     * @param {'picture'|'audio'} mediaType
     * @returns {{ directUrl: string, apiUrl: string, filename: string }}
     */
    function buildMediaTargets(example, mediaType) {
      const prefix =
        "https://us-southeast-1.linodeobjects.com/immersionkit/media";
      let category = "";
      if (example.id && typeof example.id === "string") {
        const parts = example.id.split("_");
        if (parts.length > 0) category = parts[0];
      }
      function toTitleCaseWords(s) {
        return s
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
      }
      let rawTitle = typeof example.title === "string" ? example.title : "";
      rawTitle = rawTitle.replace(/_/g, " ").replace(/\s+/g, " ").trim();
      const titleFolder = toTitleCaseWords(rawTitle);
      const encTitleFolder = encodeURIComponent(titleFolder);
      const filename = mediaType === "picture" ? example.image : example.sound;
      const encFilename = encodeURIComponent(filename);
      const directUrl = `${prefix}/${category}/${encTitleFolder}/media/${encFilename}`;
      const rawPath = `media/${category}/${titleFolder}/media/${filename}`;
      const apiUrl = `https://apiv2.immersionkit.com/download_media?path=${encodeURIComponent(
        rawPath,
      )}`;
      return { directUrl, apiUrl, filename };
    }
  
    /**
     * Add the requested media (picture or audio) from the current dictionary
     * page to the latest Anki note.  This function determines the current
     * keyword from the URL’s `keyword` parameter, fetches the first example
     * from the API, builds the media URL and then issues the appropriate
     * AnkiConnect calls.  User feedback is provided via `alert()`.
     *
     * @param {'picture'|'audio'} mediaType Which type of media to add.
     */
    /**
     * Add media to the latest Anki note for a specific example index.
     *
     * @param {'picture'|'audio'} mediaType Which type of media to add.
     * @param {number} exampleIndex Zero-based index into the examples array.
     */
    async function addMediaToAnkiForIndex(mediaType, exampleIndex) {
      const keywordParam = new URL(window.location.href).searchParams.get(
        "keyword",
      );
      if (!keywordParam) {
        alert("Cannot determine keyword from URL");
        return;
      }
      const keyword = decodeURIComponent(keywordParam);
      try {
        const examples = await fetchExamples(keyword);
        let index = Number.isFinite(exampleIndex) ? exampleIndex : 0;
        if (index < 0) index = 0;
        if (index >= examples.length) index = examples.length - 1;
        const example = examples[index];
        if (!example) throw new Error("No example available");
        if (mediaType === "picture" && !example.image)
          throw new Error("Example has no image");
        if (mediaType === "audio" && !example.sound)
          throw new Error("Example has no audio");
        const { apiUrl, filename } = buildMediaTargets(
          example,
          mediaType,
        );
        const fieldName =
          mediaType === "picture"
            ? CONFIG.IMAGE_FIELD_NAME
            : CONFIG.AUDIO_FIELD_NAME;
        // Find cards created in the last 24 hours.  The `findCards` query
        // supports the `added:1` syntax, which returns cards added in the
        // previous day.  We then pick the most recent card ID to resolve
        // into a note ID.  See the sample AnkiConnect code in the prompt.
        const recentCards = await invokeAnkiConnect("findCards", {
          query: "added:1",
        });
        if (!recentCards || recentCards.length === 0)
          throw new Error("No cards added in the last 24 hours");
        const mostRecentCard = Math.max(...recentCards);
        const noteIds = await invokeAnkiConnect("cardsToNotes", {
          cards: [mostRecentCard],
        });
        const noteId = Array.isArray(noteIds) ? noteIds[0] : noteIds;
        if (!noteId) throw new Error("Could not resolve card to note");
        const noteInfoList = await invokeAnkiConnect("notesInfo", {
          notes: [noteId],
        });
        const noteInfo = Array.isArray(noteInfoList)
          ? noteInfoList[0]
          : noteInfoList;
        if (!noteInfo || !noteInfo.fields || !(fieldName in noteInfo.fields)) {
          throw new Error(
            `Field “${fieldName}” does not exist on the latest note`,
          );
        }
        // Prefer Immersion Kit API proxy to avoid path/casing/encoding issues
        const chosenUrl = apiUrl;
        const mediaObject = { url: chosenUrl, filename, fields: [fieldName] };
        const noteUpdate = { id: noteId, fields: {} };
        // Attach the media under the correct property.  AnkiConnect expects
        // `picture` for images and `audio` for sounds.
        if (mediaType === "picture") {
          noteUpdate.picture = [mediaObject];
        } else {
          noteUpdate.audio = [mediaObject];
        }
        await invokeAnkiConnect("updateNoteFields", { note: noteUpdate });
        alert(`Successfully added ${mediaType} to Anki: ${filename}`);
      } catch (err) {
        alert(`Failed to add ${mediaType}: ${err.message}`);
      }
    }

    /**
     * Backwards-compatible wrapper that uses CONFIG.EXAMPLE_INDEX.
     *
     * @param {'picture'|'audio'} mediaType Which type of media to add.
     */
    function addMediaToAnki(mediaType) {
      return addMediaToAnkiForIndex(mediaType, CONFIG.EXAMPLE_INDEX);
    }
  
    /**
     * Poll the DOM until the “Image” and “Sound” buttons (shown in the
     * dictionary page’s example row) are present.  Once found, the script
     * inserts our Anki buttons immediately after them.  If the site changes
     * significantly and the existing buttons cannot be located, this
     * function safely times out after a reasonable number of attempts.
     */
    function insertAnkiButtons() {
      let attempts = 0;
      const maxAttempts = 40; // about 20 seconds at 500ms interval
      const interval = setInterval(() => {
        attempts++;
        // Prefer placing inside all per-item "Mining/Download" menus
        const desktopMenus = Array.from(
          document.querySelectorAll(
            "span.mobile.or.lower.hidden .ui.secondary.menu",
          ),
        );
        const mobileMenus = Array.from(
          document.querySelectorAll("span.mobile.only .ui.secondary.menu"),
        );
        const menus = desktopMenus.length > 0 ? desktopMenus : mobileMenus;
        if (menus.length > 0) {
          function createAnkiMenuItem(label, key, index, onClickFn) {
            const a = document.createElement("a");
            a.className = "item";
            a.href = "#";
            a.dataset.anki = key;
            a.dataset.ankiIndex = String(index);
            a.textContent = label;
            a.addEventListener("click", (e) => {
              e.preventDefault();
              onClickFn(index);
            });
            return a;
          }
          menus.forEach((menuEl, idx) => {
            if (!menuEl.querySelector('a.item[data-anki="image"]')) {
              const imgItem = createAnkiMenuItem(
                "Anki Image",
                "image",
                idx,
                (i) => addMediaToAnkiForIndex("picture", i),
              );
              menuEl.appendChild(imgItem);
            }
            if (!menuEl.querySelector('a.item[data-anki="audio"]')) {
              const audioItem = createAnkiMenuItem(
                "Anki Audio",
                "audio",
                idx,
                (i) => addMediaToAnkiForIndex("audio", i),
              );
              menuEl.appendChild(audioItem);
            }
          });
          clearInterval(interval);
          return;
        }
        // The ImmersionKit page displays a row with “Image” and “Sound” buttons
        // underneath the sentence selection tabs.  These buttons contain the
        // literal text “Image” and “Sound” (see screenshot in the prompt).
        const allButtons = Array.from(
          document.querySelectorAll("button, a, span, div"),
        );
        const imageButton = allButtons.find(
          (el) => el.textContent && el.textContent.trim() === "Image",
        );
        const soundButton = allButtons.find(
          (el) => el.textContent && el.textContent.trim() === "Sound",
        );
        if (imageButton || soundButton) {
          clearInterval(interval);
          // Create a small helper to generate our Anki buttons
          function createAnkiBtn(label, onClickFn) {
            const btn = document.createElement("button");
            btn.textContent = label;
            btn.style.marginLeft = "6px";
            btn.style.padding = "4px 8px";
            btn.style.fontSize = "90%";
            btn.style.cursor = "pointer";
            btn.addEventListener("click", onClickFn);
            return btn;
          }
          if (imageButton) {
            const ankiImgBtn = createAnkiBtn("Anki Image", () =>
              addMediaToAnki("picture"),
            );
            imageButton.parentNode.insertBefore(
              ankiImgBtn,
              imageButton.nextSibling,
            );
          }
          if (soundButton) {
            const ankiSoundBtn = createAnkiBtn("Anki Audio", () =>
              addMediaToAnki("audio"),
            );
            soundButton.parentNode.insertBefore(
              ankiSoundBtn,
              soundButton.nextSibling,
            );
          }
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          console.warn("ImmersionKit → Anki: Could not find Image/Sound buttons");
        }
      }, 500);
    }
  
    /**
     * Kick‑off function.  Waits until the page has finished loading then
     * attempts to insert our Anki buttons into the interface.  Using a
     * timeout here avoids race conditions with ImmersionKit’s own
     * asynchronous rendering.
     */
    function init() {
      // Some pages (especially with heavy client‑side frameworks) may fire
      // load before the dynamic components have been inserted.  Delay
      // registration slightly to give the page a chance to render.
      setTimeout(insertAnkiButtons, 1000);
    }
  
    // Start when the document is fully loaded
    if (document.readyState === "complete") {
      init();
    } else {
      window.addEventListener("load", init);
    }
  })();
  