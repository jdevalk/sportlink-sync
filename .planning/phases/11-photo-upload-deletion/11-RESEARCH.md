# Phase 11: Photo Upload and Deletion - Research

**Researched:** 2026-01-26
**Domain:** WordPress REST API media uploads, multipart form-data, file deletion
**Confidence:** MEDIUM

## Summary

This phase uploads photos downloaded in Phase 10 to Stadion WordPress and handles photo deletion from both local storage and Stadion when photos are removed in Sportlink. The standard approach uses multipart/form-data requests to a custom WordPress REST API endpoint (`POST /stadion/v1/people/{id}/photo`) for uploading, and DELETE requests to remove photos. File operations use Node.js native fs/promises for local photo deletion.

The Stadion plugin appears to provide a custom REST API endpoint specifically for photo uploads to the "people" post type. Based on standard WordPress custom endpoint patterns, this endpoint likely accepts multipart/form-data with Basic Authentication (Application Password), similar to the standard `/wp/v2/media` endpoint but specialized for attaching photos directly to person records.

Photo upload follows existing pipeline patterns: sequential processing with rate limiting, hash-based state tracking in SQLite (photo_state transitions), graceful error handling with logging, and SQLite transactions for batch state updates. Deletion is bidirectional: detect when PersonImageDate becomes empty, delete local file via fs.unlink, and delete from Stadion via API.

**Primary recommendation:** Create upload-photos-to-stadion.js following the existing submit-stadion-sync.js pattern. Use form-data npm package (already installed) to construct multipart requests with file buffers from photos/ directory. Implement sequential upload with 2-second delays matching existing rate limits. For deletion, detect photo_state = 'pending_delete', remove local files with fs.promises.unlink(), then call custom DELETE endpoint or standard DELETE /wp/v2/media/{attachment_id}. All operations update photo_state in SQLite transactions.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| form-data | 4.x (already installed) | Multipart request construction | De facto standard for Node.js multipart uploads, handles boundary generation automatically |
| Node.js https | Native | HTTP client | Already used in lib/stadion-client.js, consistent with existing patterns |
| Node.js fs/promises | Native | File operations | Modern async file API, used throughout codebase |
| better-sqlite3 | latest (already installed) | State tracking | Photo state transitions tracked in stadion_members table |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| axios | N/A | HTTP client alternative | NOT NEEDED - existing stadion-client.js uses native https module |
| multer | N/A | Form parsing middleware | NOT NEEDED - this is server-side middleware, we're a client |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| form-data package | Manual boundary construction | Manual construction error-prone and verbose; form-data handles edge cases |
| Custom photo endpoint | Standard /wp/v2/media | Custom endpoint may handle person-photo attachment logic; standard requires separate linking step |
| fs.unlink for deletion | fs.rm (Node 14.14+) | fs.rm more modern but unlink is well-established; both work for single file deletion |

**Installation:**
No additional packages needed - form-data already in package.json.

## Architecture Patterns

### Recommended Project Structure
```
sportlink-sync/
├── upload-photos-to-stadion.js   # NEW: Photo upload orchestrator
├── delete-photos.js               # NEW: Photo deletion handler
├── photos/                        # Existing: Downloaded photos
├── lib/
│   ├── stadion-client.js          # Extend or wrap for multipart support
│   ├── stadion-db.js              # Already has photo state functions
│   └── logger.js                  # Reuse for upload/delete logging
└── sync-all.js                    # Integrate photo upload/delete steps
```

### Pattern 1: Multipart Upload with form-data
**What:** Construct multipart/form-data request with file buffer and metadata
**When to use:** Uploading binary files to REST API endpoints
**Example:**
```javascript
// Source: form-data npm docs + WordPress REST API patterns
const FormData = require('form-data');
const fs = require('fs');
const https = require('https');

async function uploadPhotoToStadion(stadionId, photoPath, options) {
  const form = new FormData();

  // Append file as stream or buffer
  form.append('file', fs.createReadStream(photoPath));

  // Optional metadata (depends on endpoint requirements)
  form.append('alt_text', 'Member photo');

  // Get form headers (includes boundary)
  const formHeaders = form.getHeaders();

  // Merge with auth headers from stadion-client.js pattern
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: parsedUrl.hostname,
      port: 443,
      path: `/wp-json/stadion/v1/people/${stadionId}/photo`,
      method: 'POST',
      headers: {
        ...formHeaders,
        'Authorization': authHeader
      }
    }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ status: response.statusCode, body: JSON.parse(data) });
        } else {
          reject(new Error(`Upload failed: ${response.statusCode}`));
        }
      });
    });

    form.pipe(request);
    request.on('error', reject);
  });
}
```

### Pattern 2: Sequential Upload with State Tracking
**What:** Process members sequentially, update photo_state in transaction after batch
**When to use:** Always - matches existing sync pattern and rate limiting requirements
**Example:**
```javascript
// Source: Existing pattern from submit-stadion-sync.js
const { openDb, getMembersByPhotoState, updatePhotoState } = require('./lib/stadion-db');

async function runPhotoUpload(options = {}) {
  const db = openDb();
  try {
    // Get members with downloaded photos ready for upload
    const members = getMembersByPhotoState(db, 'downloaded');

    for (let i = 0; i < members.length; i++) {
      const member = members[i];

      try {
        // Construct photo path
        const photoPath = findPhotoFile(member.knvb_id); // Check .jpg, .png, .webp

        if (!member.stadion_id) {
          // Data integrity error - member should exist
          logger.error(`Member ${member.knvb_id} has no stadion_id - cannot upload photo`);
          continue;
        }

        // Upload to Stadion
        await uploadPhotoToStadion(member.stadion_id, photoPath, options);

        // Update state
        updatePhotoState(db, member.knvb_id, 'synced');

      } catch (error) {
        logger.error(`Failed to upload photo for ${member.knvb_id}: ${error.message}`);
        // Continue to next member - don't fail fast
      }

      // Rate limit: 2 seconds between uploads
      if (i < members.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  } finally {
    db.close();
  }
}
```

### Pattern 3: Photo File Discovery
**What:** Find photo file for member by checking multiple extensions
**When to use:** When photo extension varies (jpg/png/webp)
**Example:**
```javascript
// Source: Common pattern for file discovery
const fs = require('fs/promises');
const path = require('path');

const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

async function findPhotoFile(knvbId) {
  const photosDir = path.join(process.cwd(), 'photos');

  for (const ext of PHOTO_EXTENSIONS) {
    const filepath = path.join(photosDir, `${knvbId}.${ext}`);
    try {
      await fs.access(filepath);
      return filepath; // File exists
    } catch {
      // Try next extension
    }
  }

  throw new Error(`No photo file found for ${knvbId}`);
}
```

### Pattern 4: Safe File Deletion
**What:** Delete file with existence check and error handling
**When to use:** Removing local photos when PersonImageDate becomes empty
**Example:**
```javascript
// Source: Node.js fs best practices + WebSearch findings
const fs = require('fs/promises');

async function deletePhotoFile(knvbId) {
  try {
    const photoPath = await findPhotoFile(knvbId);
    await fs.unlink(photoPath);
    logger.verbose(`Deleted local photo: ${photoPath}`);
    return { success: true, path: photoPath };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - already deleted or never downloaded
      logger.verbose(`Photo file not found for ${knvbId} - already deleted`);
      return { success: true, notFound: true };
    }
    throw error; // Other errors (permissions, etc.)
  }
}
```

### Pattern 5: Bidirectional Photo Deletion
**What:** Delete photo from both local storage and Stadion when removed in Sportlink
**When to use:** When photo_state = 'pending_delete'
**Example:**
```javascript
// Source: Existing delete pattern from submit-stadion-sync.js + photo deletion logic
async function runPhotoDeletion(options = {}) {
  const db = openDb();
  try {
    const members = getMembersByPhotoState(db, 'pending_delete');

    for (const member of members) {
      try {
        // Delete local file
        await deletePhotoFile(member.knvb_id);

        // Delete from Stadion (if member still exists)
        if (member.stadion_id) {
          // Option 1: Custom endpoint (if exists)
          await stadionRequest(
            `stadion/v1/people/${member.stadion_id}/photo`,
            'DELETE',
            null,
            options
          );

          // Option 2: Standard media endpoint (requires attachment ID)
          // await stadionRequest(`wp/v2/media/${attachmentId}?force=true`, 'DELETE', null, options);
        }

        // Clear photo state
        clearPhotoState(db, member.knvb_id);

      } catch (error) {
        logger.error(`Failed to delete photo for ${member.knvb_id}: ${error.message}`);
        // Continue to next member
      }

      await new Promise(r => setTimeout(r, 2000)); // Rate limit
    }
  } finally {
    db.close();
  }
}
```

### Anti-Patterns to Avoid
- **Uploading photos before member sync:** Member must exist in Stadion first (created in Phase 6/7)
- **Using photo_state without transactions:** State changes must be atomic to prevent inconsistency
- **Failing fast on upload errors:** Log and continue - one failure shouldn't block entire batch
- **Manual multipart construction:** Use form-data package to avoid boundary formatting errors
- **Synchronous file operations:** Always use fs/promises for non-blocking I/O
- **Uploading without KNVB ID matching:** Always verify member.stadion_id exists before upload

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multipart boundary formatting | Manual Buffer.concat with boundary string | form-data npm package | Boundary generation has edge cases (CRLF handling, RFC compliance); form-data handles all specs |
| File extension detection | String parsing or magic numbers | Filename from photo download (already has correct extension) | Photos downloaded in Phase 10 already have correct extensions from MIME type mapping |
| HTTP Basic Auth header | Manual base64 encoding | Existing pattern in stadion-client.js | Already implemented and tested; reuse the same auth logic |
| Rate limiting | Custom delay logic | Simple setTimeout matching existing 2-second pattern | Existing pipeline uses 2-second delays; keep consistency |
| Photo file finding | Directory listing and filtering | Check known extensions sequentially | Small set of extensions (jpg/png/webp); direct check is simpler than fs.readdir |

**Key insight:** The form-data package is critical - manual multipart construction is error-prone (boundary conflicts, CRLF issues, header formatting). Always use fs/promises for async file I/O. Reuse existing stadion-client.js authentication pattern rather than reimplementing Basic Auth.

## Common Pitfalls

### Pitfall 1: Missing Member in Stadion
**What goes wrong:** Photo upload fails because member.stadion_id is null (member never synced to Stadion)
**Why it happens:** Photo download happens independently of member sync; member may not exist yet
**How to avoid:**
- Always check `if (!member.stadion_id)` before attempting upload
- Log as ERROR (data integrity issue) - member sync should have created them
- Don't attempt to create member in photo sync - that's Phase 6/7 responsibility
- Skip photo upload, leave photo_state as 'downloaded' for retry after member sync
**Warning signs:** 404 errors from Stadion API, null stadion_id in database, logs showing "member not found"

### Pitfall 2: Form Boundary Issues
**What goes wrong:** Multipart upload fails with malformed request or boundary errors
**Why it happens:** Manual boundary construction has subtle bugs (CRLF placement, boundary uniqueness, header formatting)
**How to avoid:**
- Always use form-data npm package - never construct boundaries manually
- Call `form.getHeaders()` to get proper Content-Type with boundary
- Let form-data handle piping to request - don't manually write buffers
- Don't modify boundary string or Content-Type header manually
**Warning signs:** 400 Bad Request, "Malformed multipart request", missing boundary errors from WordPress

### Pitfall 3: File Not Found During Upload
**What goes wrong:** Photo file doesn't exist at expected path (wrong extension or deleted)
**Why it happens:** Extension mismatch between download and upload, or manual file deletion
**How to avoid:**
- Use `findPhotoFile()` helper to check all known extensions
- Handle ENOENT gracefully - log warning and skip member
- Don't fail entire batch on single missing file
- Consider validating photo_state = 'downloaded' actually has corresponding file
**Warning signs:** ENOENT errors, "No photo file found", empty file reads

### Pitfall 4: Race Condition with Member Deletion
**What goes wrong:** Attempting to upload photo for member that was just deleted from Stadion
**Why it happens:** Member deleted in Sportlink between photo download and upload phases
**How to avoid:**
- Check photo_state before upload - skip if 'pending_delete'
- Handle 404 responses gracefully during upload (member may have been deleted)
- Don't treat 404 as fatal error - log and continue
- Consider member sync running concurrently and invalidating stadion_id
**Warning signs:** 404 errors during upload, mismatched photo_state transitions

### Pitfall 5: Overwriting Wrong Photo Endpoint
**What goes wrong:** Uploading to /wp/v2/media instead of custom endpoint creates unattached media
**Why it happens:** Using standard media endpoint doesn't link photo to person record
**How to avoid:**
- Use custom `/stadion/v1/people/{id}/photo` endpoint (requirement PHOTO-06)
- This endpoint likely handles attachment to person post automatically
- If endpoint doesn't exist, will need two-step: upload to /wp/v2/media, then link via person update
- Verify endpoint exists early - test with single upload before batch processing
**Warning signs:** Photos in media library but not attached to person, orphaned attachments

### Pitfall 6: Not Handling Deletion Failures Gracefully
**What goes wrong:** Local file deleted but Stadion deletion fails, or vice versa
**Why it happens:** Network error or permission issue causes partial deletion
**How to avoid:**
- Delete local file first (no network dependency), then attempt Stadion deletion
- If Stadion deletion fails, log error but still clear photo_state (local file is gone)
- On next run, photo_state will be correct (no_photo) even if Stadion has orphaned image
- Alternative: keep photo_state as 'pending_delete' until both succeed (retry logic)
**Warning signs:** Inconsistent state between local and Stadion, orphaned photos in WordPress

## Code Examples

Verified patterns from official sources:

### Complete Multipart Upload Function
```javascript
// Source: form-data npm docs + stadion-client.js pattern
const FormData = require('form-data');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');

function uploadPhotoToStadion(stadionId, photoPath, options = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();

    // Append file stream
    form.append('file', fs.createReadStream(photoPath));

    // Get environment variables
    const baseUrl = process.env.STADION_URL;
    const username = process.env.STADION_USERNAME;
    const password = process.env.STADION_APP_PASSWORD;

    // Build auth header
    const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

    // Parse URL
    const parsedUrl = new URL(baseUrl);
    const path = `/wp-json/stadion/v1/people/${stadionId}/photo`;

    // Merge headers
    const headers = {
      ...form.getHeaders(), // Includes Content-Type with boundary
      'Authorization': authHeader
    };

    options.logger?.verbose(`Uploading photo to ${path}`);

    const request = https.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: path,
      method: 'POST',
      headers: headers,
      timeout: 30000
    }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try {
            const body = JSON.parse(data);
            resolve({ status: response.statusCode, body });
          } catch {
            resolve({ status: response.statusCode, body: data });
          }
        } else {
          const error = new Error(`Upload failed: ${response.statusCode}`);
          error.status = response.statusCode;
          error.details = data;
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Upload timeout'));
    });

    // Pipe form to request
    form.pipe(request);
  });
}
```

### Photo File Discovery with Multiple Extensions
```javascript
// Source: Node.js fs best practices
const fs = require('fs/promises');
const path = require('path');

const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

async function findPhotoFile(knvbId) {
  const photosDir = path.join(process.cwd(), 'photos');

  for (const ext of PHOTO_EXTENSIONS) {
    const filepath = path.join(photosDir, `${knvbId}.${ext}`);
    try {
      await fs.access(filepath, fs.constants.R_OK);
      return filepath;
    } catch (error) {
      // File doesn't exist or not readable, try next extension
      continue;
    }
  }

  throw new Error(`No photo file found for KNVB ID ${knvbId}`);
}
```

### Safe File Deletion with Error Handling
```javascript
// Source: Node.js fs.unlink best practices + WebSearch findings
const fs = require('fs/promises');

async function deletePhotoFileSafely(knvbId, logger) {
  try {
    const photoPath = await findPhotoFile(knvbId);
    await fs.unlink(photoPath);
    logger.verbose(`Deleted local photo: ${photoPath}`);
    return { success: true, deleted: photoPath };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - already deleted or findPhotoFile failed
      logger.verbose(`Photo file not found for ${knvbId}`);
      return { success: true, notFound: true };
    }

    if (error.code === 'EPERM' || error.code === 'EACCES') {
      // Permission error
      logger.error(`Permission denied deleting photo for ${knvbId}`);
      throw error;
    }

    // Other errors
    throw error;
  }
}
```

### Complete Upload Orchestration
```javascript
// Source: Existing submit-stadion-sync.js pattern
const { openDb, getMembersByPhotoState, updatePhotoState } = require('./lib/stadion-db');
const { createSyncLogger } = require('./lib/logger');

async function runPhotoUpload(options = {}) {
  const { logger: providedLogger, verbose = false } = options;
  const logger = providedLogger || createSyncLogger({ verbose });

  const result = {
    success: true,
    total: 0,
    uploaded: 0,
    skipped: 0,
    errors: []
  };

  const db = openDb();
  try {
    // Get members with downloaded photos
    const members = getMembersByPhotoState(db, 'downloaded');
    result.total = members.length;

    if (members.length === 0) {
      logger.log('No photos pending upload');
      return result;
    }

    logger.log(`${members.length} photos pending upload`);

    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      logger.verbose(`Uploading photo ${i + 1}/${members.length}: ${member.knvb_id}`);

      try {
        // Check member exists in Stadion
        if (!member.stadion_id) {
          logger.error(`Member ${member.knvb_id} not synced to Stadion - cannot upload photo`);
          result.skipped++;
          continue;
        }

        // Find photo file
        const photoPath = await findPhotoFile(member.knvb_id);

        // Upload to Stadion
        await uploadPhotoToStadion(member.stadion_id, photoPath, { logger, verbose });

        // Update state
        updatePhotoState(db, member.knvb_id, 'synced');
        result.uploaded++;

      } catch (error) {
        result.errors.push({ knvb_id: member.knvb_id, message: error.message });
        logger.error(`Failed to upload ${member.knvb_id}: ${error.message}`);
        // Continue to next member
      }

      // Rate limit
      if (i < members.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    logger.log(`Uploaded ${result.uploaded}/${result.total} photos`);
    if (result.errors.length > 0) {
      logger.log(`Errors: ${result.errors.length}`);
      result.success = false;
    }

    return result;

  } finally {
    db.close();
  }
}

module.exports = { runPhotoUpload };
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| request npm package for multipart | form-data + native https | request deprecated 2020 | form-data actively maintained, better streaming support |
| Manual multipart construction | form-data.getHeaders() | Always best practice | Automatic boundary generation prevents formatting errors |
| fs.unlinkSync() | fs.promises.unlink() | Node 10+ | Non-blocking, better for production |
| Separate media + link steps | Custom photo endpoint | Plugin-specific | Single request attaches photo to person |
| Uploading all extensions as .jpg | Extension detection via MIME type | Current standard | Preserves original format (png/webp) |

**Deprecated/outdated:**
- **request npm package**: Deprecated since February 2020; use form-data + native https or axios
- **Synchronous fs.unlinkSync**: Blocks event loop; always use fs.promises.unlink() in production
- **Manual boundary string generation**: Error-prone and unnecessary; form-data handles this

## Open Questions

Things that couldn't be fully resolved:

1. **Custom Stadion Photo Endpoint Implementation**
   - What we know: Requirements specify `POST /stadion/v1/people/{id}/photo` endpoint
   - What's unclear: Whether this endpoint exists in Stadion plugin, or needs to be created
   - Recommendation: Test endpoint existence first with single request. If 404, fallback to standard /wp/v2/media upload + manual attachment linking via person update
   - Confidence: LOW - Custom endpoint not verified in public documentation

2. **Photo Deletion Endpoint**
   - What we know: Need to delete photos from Stadion when PersonImageDate becomes empty
   - What's unclear: Whether to use `DELETE /stadion/v1/people/{id}/photo` or standard `/wp/v2/media/{attachment_id}?force=true`
   - Recommendation: Try custom endpoint first; if doesn't exist, use standard media deletion (requires fetching attachment_id first)
   - Confidence: LOW - Deletion endpoint not documented

3. **Attachment ID Resolution**
   - What we know: Standard WordPress media deletion requires attachment post ID
   - What's unclear: How to get attachment ID for a person's photo (query media by parent post_id?)
   - Recommendation: If custom endpoint doesn't exist, query `/wp/v2/media?parent={person_id}` to find attachment ID
   - Confidence: MEDIUM - Standard WordPress pattern but not tested with Stadion

4. **Error Recovery Strategy**
   - What we know: User decision is "log failures and continue"
   - What's unclear: Should failed uploads stay in 'downloaded' state for retry, or mark as 'error' state?
   - Recommendation: Leave in 'downloaded' state for automatic retry on next run; add error counter or timestamp if repeated failures
   - Confidence: MEDIUM - Aligns with "resumable" pattern but needs validation

5. **Partial Deletion Handling**
   - What we know: Local file deletion can succeed while Stadion deletion fails (or vice versa)
   - What's unclear: Should photo_state clear on local deletion success, or wait for both?
   - Recommendation: Clear photo_state after local deletion success (source of truth is local file); log Stadion deletion failures separately
   - Confidence: LOW - Tradeoff between consistency and retry complexity

## Sources

### Primary (HIGH confidence)
- [form-data npm package](https://www.npmjs.com/package/form-data) - Official documentation for multipart construction
- [Node.js fs/promises API](https://nodejs.org/api/fs.html) - Official Node.js file system documentation
- [WordPress REST API Media Reference](https://developer.wordpress.org/rest-api/reference/media/) - Official WordPress media endpoint documentation
- Existing codebase:
  - lib/stadion-client.js (lines 38-135) - HTTPS request pattern with Basic Auth
  - submit-stadion-sync.js (lines 22-64, 358-460) - Sequential processing, rate limiting, error handling
  - lib/stadion-db.js (lines 410-450) - Photo state tracking functions
  - download-photos-from-sportlink.js (lines 28-44, 231-314) - MIME type mapping, file operations

### Secondary (MEDIUM confidence)
- [Upload an Image using WordPress REST API](https://rudrastyh.com/wordpress/upload-featured-image-rest-api.html) - Tutorial on WordPress image uploads (updated April 2025)
- [Node.js File System – unlink() for File Deletion](https://dev.to/mccallum91/nodejs-file-system-utilizing-unlink-and-unlinksync-for-file-deletion-595e) - Best practices for file deletion
- [Multipart-POST Request Using Node.js](https://gist.github.com/tanaikech/40c9284e91d209356395b43022ffc5cc) - GitHub Gist showing form-data usage patterns
- [Adding a custom endpoint to WordPress REST API to upload files](https://firxworx.com/blog/code/adding-an-endpoint-to-wordpress-rest-api-for-file-uploads/) - Custom endpoint patterns (2018, still relevant for structure)

### Tertiary (LOW confidence - flagged for validation)
- Custom `/stadion/v1/people/{id}/photo` endpoint - Mentioned in requirements but not found in public documentation; needs testing
- Photo deletion via custom endpoint - Not verified; may need to use standard media deletion pattern
- Automatic photo-to-person attachment - Unclear if custom endpoint handles linking or requires separate update

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - form-data and fs/promises are proven, well-documented libraries
- Architecture: MEDIUM - Patterns verified against existing codebase, but custom Stadion endpoint unverified
- Pitfalls: MEDIUM - Based on WordPress REST API experience and Node.js file handling best practices; custom endpoint behavior unknown

**Research date:** 2026-01-26
**Valid until:** 2026-02-25 (30 days - stable domain, though custom endpoint needs early validation)
