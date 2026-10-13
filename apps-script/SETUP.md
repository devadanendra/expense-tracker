# Set up the Google Sheet backup

The app keeps your expenses on your phone. This one-time setup gives it a Google Sheet to push a copy to, so you can restore them on a new phone. You need a Google account and about 10 minutes. No coding.

## Steps

1. **Create the Sheet.** Go to [sheets.google.com](https://sheets.google.com), start a blank spreadsheet and name it, for example, "Expense Tracker backup". Leave it empty. The script creates its own `Expenses` and `Categories` tabs.

2. **Open the script editor.** In the Sheet choose **Extensions › Apps Script**. A code editor opens in a new tab.

3. **Paste the code.** Delete everything in the editor. Open `apps-script/Code.gs` from this repository, copy all of it, paste it into the editor, and press the save icon (or Ctrl+S).

4. **Choose a passphrase.** Make it long: 4 or more random words and a number, made up by you, 25+ characters in all. Never use an example from a guide, do not reuse a password from anywhere else, and do not start or end it with a space. You will type it once into the app, and Chrome Password Manager will offer to remember it, so it does not need to be easy to type.

5. **Save the passphrase in the script.** In the editor, click the gear icon (**Project Settings**), scroll to **Script properties**, click **Add script property**, set the property to `PASSPHRASE` (capital letters, exactly) and the value to your passphrase, then click **Save script properties**. The passphrase now lives only in your Google account. Never put it in this repository.

6. **Deploy it.** Click **Deploy › New deployment**. Click the gear next to "Select type" and choose **Web app**. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone

   Click **Deploy**.

7. **Authorize it.** Click **Authorize access** and pick your Google account. Google warns that the app is not verified, because you wrote it yourself. Click **Advanced › Go to (project name) (unsafe)**, then **Allow**. The script can only touch this one spreadsheet.

8. **Copy the Web app URL.** It ends in `/exec`.

9. **Check that it works.** Paste the URL into a browser tab. You should see exactly:

   ```
   {"ok":true,"app":"expense-tracker"}
   ```

   If you see a Google sign-in page or an error instead, go to **Deploy › Manage deployments** and confirm **Who has access** is **Anyone**.

10. **Give the URL to the app.** Open `js/config.js` in this repository and set:

    ```js
    export const SHEET_URL = 'https://script.google.com/macros/s/XXXX/exec';
    ```

    In the same commit, open `sw.js` and change the `CACHE` version to the next one (for example `et-v1` to `et-v2`). An installed app keeps serving its cached `js/config.js` until `sw.js` changes.

    Commit and push, then wait for GitHub Pages to publish. The URL is not a secret and may be committed. The passphrase is the secret and must never be committed.

11. **Connect the phone.** In the app open **Settings › Google Sheet sync**, enter the passphrase, and tap **Connect**. Accept Chrome's offer to save the password. The first connection creates the two tabs in your Sheet.

12. **Check the backup.** In the app, save an expense with the note `=1+1 '90s 1/2`. When **Settings › Google Sheet sync** shows **Synced**, open the Sheet's `Expenses` tab. The note cell must show exactly `=1+1 '90s 1/2` (not `2`), and the date cell must show text like `2026-10-13`. If either differs, the tabs were probably made by hand, not by the script: delete the `Expenses` and `Categories` tabs, then tap **Settings › Restore from Sheet** and restore. The script recreates both tabs and the app sends everything again. If the check still fails, open an issue in this repository. Delete the test expense afterwards.

## Why "Anyone" is safe

"Anyone" only means Google does not ask visitors to sign in. Every request is rejected unless it carries the passphrase, and the script never returns data without it. So the passphrase is the lock: keep it long and private, and anyone who only has the URL gets nothing. If you ever think the passphrase leaked, change the `PASSPHRASE` script property (step 5) and reconnect the app. No redeploy is needed for that.

## Changing the code later

Editing `Code.gs` in the editor does not change the live web app until you redeploy:

1. **Deploy › Manage deployments**.
2. Click the pencil icon (**Edit**) on your deployment.
3. Set **Version** to **New version**, then click **Deploy**.

The URL stays the same, so `js/config.js` does not change. Do not use **New deployment** for this: it creates a second, different URL.

## Notes

- The phone is the main copy. The Sheet is a one-way backup the app writes to. Edits you make by hand in the Sheet are not read back by the app (and are overwritten the next time that row changes on the phone). The app reads the Sheet only when you tap **Restore from Sheet** or connect a new phone.
- The default `Sheet1` tab is not used. Delete it or ignore it.
- **Wrong passphrase** in the app: the script property must match exactly, with no leading or trailing space.
