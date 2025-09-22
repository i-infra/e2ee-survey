# Encrypted Survey Tool

A privacy-focused, end-to-end encrypted survey platform built on Cloudflare Workers. This tool provides a secure alternative to traditional survey platforms by ensuring that even the service provider cannot access survey questions or responses.

## Features

- **End-to-End Encryption**: All survey data is encrypted client-side using TweetNaCl and Argon2
- **Zero-Knowledge Architecture**: Server cannot decrypt survey content or responses
- **Anonymous Operation**: No user accounts or tracking required
- **Markdown-Based Surveys**: Simple syntax for creating surveys
- **Real-time Analytics**: Encrypted response analysis for survey creators
- **Automatic Cleanup**: Surveys expire and are cleaned up automatically

## Quick Start

### Prerequisites

- Node.js 18+
- Cloudflare account with Workers and D1 access
- Wrangler CLI installed globally

### Setup

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Build static assets:**
   ```bash
   npm run build
   ```

3. **Create D1 database:**
   ```bash
   wrangler d1 create encrypted-survey-db
   ```

4. **Update wrangler.toml with your database ID:**
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "encrypted-survey-db"
   database_id = "your-database-id-here"  # Replace with actual ID
   ```

5. **Run database migrations:**
   ```bash
   wrangler d1 execute encrypted-survey-db --file=./schemas/001-initial.sql
   ```

6. **Start development server:**
   ```bash
   npm run dev
   ```

### Deployment

The deployment process automatically builds static assets before deploying:

```bash
npm run deploy
```

This runs:
1. `npm run build` - Generates `src/worker/assets.js` with inlined static files
2. `wrangler deploy` - Deploys the worker with embedded assets

## Survey Format

Surveys are written in simple markdown format:

```markdown
# Survey Title
Optional survey description goes here.

## Questions

- **yes/no** Are you satisfied with our service?
- **text** What could we improve?
- **yes/no** Would you recommend us to a friend?
- **text** Any additional comments?
```

## API Endpoints

- `POST /api/survey` - Create new encrypted survey
- `GET /api/survey/:id` - Get encrypted survey data
- `POST /api/survey/:id/response` - Submit encrypted response
- `GET /api/survey/:id/responses` - Get responses (creator only)

## Security Model

### Encryption Process

1. **Survey Creation**: 
   - User provides survey markdown and password
   - Argon2i derives encryption key from password + random salt
   - Survey data encrypted with TweetNaCl SecretBox
   - Only encrypted data stored on server

2. **Response Submission**:
   - Survey decrypted client-side with password
   - User fills out form
   - Responses encrypted with same key
   - Encrypted responses stored

3. **Analysis**:
   - Creator provides password to decrypt survey and responses
   - All decryption happens client-side
   - Server never sees plaintext data

### Threat Model

**Protected Against:**
- Server-side data breaches
- Man-in-the-middle attacks (encrypted payloads)
- Survey impersonation (key hash verification)
- Unauthorized response access

**Limitations:**
- Lost password = lost access (by design)
- Client-side compromise could expose data
- Does not protect against survey creator sharing password

## Architecture

```
┌─────────────────┐    HTTPS    ┌─────────────────┐
│   Browser       │◄───────────►│ Cloudflare      │
│ (Encryption)    │             │ Workers + D1    │
└─────────────────┘             └─────────────────┘
         │                               │
         │ Encrypted Data Only           │ Encrypted Storage
         ▼                               ▼
┌─────────────────┐             ┌─────────────────┐
│ TweetNaCl +     │             │ D1 Database     │
│ Argon2i         │             │ (SQLite)        │
└─────────────────┘             └─────────────────┘
```

## File Structure

```
encrypted-survey/
├── src/
│   ├── worker/           # Cloudflare Worker backend
│   │   ├── index.js      # Main worker entry point
│   │   ├── database.js   # D1 database operations
│   │   └── assets.js     # Generated file with inlined static assets
│   └── shared/           # Shared utilities
│       ├── crypto.js     # Encryption/decryption
│       └── survey-parser.js # Markdown parsing
├── public/               # Static HTML files (inlined at build time)
│   ├── index.html        # Landing page
│   ├── create.html       # Survey creation
│   ├── survey.html       # Survey response
│   └── analyze.html      # Response analysis
├── scripts/              # Build tools
│   └── build-assets.js   # Inlines static files into worker
├── schemas/              # Database migrations
└── wrangler.toml         # Cloudflare configuration
```

## Development

### Build Process

The project uses a build step to inline static assets into the worker:

```bash
# Build static assets (generates src/worker/assets.js)
npm run build

# Development (builds automatically)
npm run dev

# Deploy (builds automatically) 
npm run deploy
```

### Running Tests

```bash
# Test locally with Wrangler
wrangler dev --local

# Or with Docker
npm run dev:docker
```

### Database Migrations

```bash
# Create new migration
wrangler d1 execute encrypted-survey-db --file=./schemas/002-new-migration.sql

# For production
wrangler d1 execute encrypted-survey-db --file=./schemas/002-new-migration.sql --env production
```

## Privacy & Security

### Encryption Details

- **Key Derivation**: Argon2i with OPSLIMIT_MODERATE and MEMLIMIT_MODERATE
- **Symmetric Encryption**: TweetNaCl SecretBox (XSalsa20 + Poly1305)
- **Salt**: 16 random bytes per survey
- **Nonce**: 24 random bytes per encrypted message

### Data Retention

- Surveys are automatically deleted after 30 days
- No personal information is collected or stored
- IP addresses are not logged (beyond Cloudflare defaults)

### Compliance

This tool is designed to help with:
- GDPR compliance (data minimization, privacy by design)
- HIPAA requirements (no PHI storage in plaintext)
- Internal privacy policies

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the existing issues on GitHub
2. Review the documentation
3. Create a new issue with detailed information

## Roadmap

- [ ] File upload questions (encrypted)
- [ ] Survey templates
- [ ] Response export formats (CSV, PDF)
- [ ] Advanced analytics
- [ ] Survey sharing improvements
- [ ] Mobile app