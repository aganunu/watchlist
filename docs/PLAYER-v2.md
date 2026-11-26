# Player v2 Core

Playback uses the existing target identity. A movie uses `movie|identityKey`, and an episode uses `episode|identityKey|seasonNumber|episodeNumber`. The identity comes from the library item or confirmed TMDB reference. Episode titles are display metadata. The existing progress entries retain their time, duration, completion flag and update timestamp. Continue Watching shows resumable entries, newest first.

After source selection, resumable entries offer **Продолжить с …** or **Смотреть сначала**. A restart keeps the previous position until the new media can play. Retry and same-target source replacement reuse the launch decision. A completed entry opens without a resume question.

Each media attempt uses the existing request token. Its runtime state tracks loading, ready, playing, paused, ended and error. The source and resume dialogs precede media creation. Leaving the player or replacing media invalidates pending work and removes media listeners. The native local-file path revokes the object URL during teardown. Vidstack and pinned hls.js continue to handle remote streams and available HLS quality levels.

The source chooser keeps URL and format drafts in a document-local map keyed by the playback target. Reload discards drafts. The header shows the source type. URLs, provider credentials, filenames, Files and object URLs stay out of Watchlist state, backups, cloud payloads and sync conflict snapshots. After reload, a local file must be selected again.

Episode buttons use TMDB's numbered episode metadata, skip season zero and can cross season boundaries. Each episode in the portrait panel shows its own progress or completion state. At the end of an episode, the next button opens that episode's source chooser. At the end of a movie, replay uses the current source, and Back returns to the originating screen. Completion updates playback progress independently of the library's Watched flag. The source chooser can reset the selected target after confirmation.

Playback depends on the browser's supported formats and the remote server's access and CORS rules. TMDB provides metadata, and source selection remains user-driven. The home-engine and provider resolvers remain placeholders.
