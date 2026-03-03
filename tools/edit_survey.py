#!/usr/bin/env python3
"""
Survey Question Editor

This script fetches encrypted survey questions from Cloudflare D1,
decrypts them, opens them in vim for editing, and updates the database
with the re-encrypted questions.

⚠️  CRITICAL WARNING - DATA INTEGRITY ⚠️
========================================
REORDERING questions will CORRUPT all existing response data!
Question IDs are regenerated based on position in the markdown file.
Moving questions causes answer mismatches in CSV/JSON exports.

SAFE: Edit text, add questions to END
UNSAFE: Reorder, remove, or change question IDs

See markdown_to_survey() docstring for detailed impact analysis.

Usage:
    ./edit_survey.py --env .krvmedics --survey-id 01KHHPEB2570T6F7H0C154P3H0
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import requests
from nacl.secret import SecretBox
from nacl import utils
import argon2


def load_env_file(env_file):
    """Load environment variables from a .env-style file."""
    env_vars = {}
    with open(env_file, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                # Remove quotes if present
                value = value.strip('"').strip("'")
                env_vars[key] = value
    return env_vars


def cloudflare_query(account_id, api_token, database_id, sql):
    """Execute a SQL query against Cloudflare D1."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"

    # Create a temporary config file for curl to handle the token properly
    with tempfile.NamedTemporaryFile(mode='w', suffix='.conf', delete=False) as f:
        f.write(f'header = "Authorization: Bearer {api_token}"\n')
        f.write('header = "Content-Type: application/json"\n')
        config_file = f.name

    try:
        # Use curl with config file to avoid argument parsing issues
        result = subprocess.run(
            ['curl', '-X', 'POST', url, '-K', config_file, '-d', json.dumps({'sql': sql})],
            capture_output=True,
            text=True,
            check=True
        )

        response = json.loads(result.stdout)

        if not response.get('success'):
            raise Exception(f"Query failed: {response.get('errors', 'Unknown error')}")

        return response['result'][0]['results']

    finally:
        os.unlink(config_file)


def get_database_id(account_id, api_token, database_name):
    """Get the database UUID from its name."""
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database"

    with tempfile.NamedTemporaryFile(mode='w', suffix='.conf', delete=False) as f:
        f.write(f'header = "Authorization: Bearer {api_token}"\n')
        config_file = f.name

    try:
        result = subprocess.run(
            ['curl', '-X', 'GET', url, '-K', config_file],
            capture_output=True,
            text=True,
            check=True
        )

        response = json.loads(result.stdout)

        if not response.get('success'):
            raise Exception(f"Failed to list databases: {response.get('errors', 'Unknown error')}")

        for db in response['result']:
            if db['name'] == database_name:
                return db['uuid']

        raise Exception(f"Database '{database_name}' not found")

    finally:
        os.unlink(config_file)


def derive_key(password, salt):
    """Derive encryption key using Argon2i (compatible with nacl implementation)."""
    # Convert password to bytes
    password_bytes = password.encode('utf-8')
    salt_bytes = bytes(salt)

    # Use same parameters as the JavaScript implementation
    # time_cost (opslimit) = 3, memory_cost (memlimit) = 262144 KB = 256 MB
    hasher = argon2.PasswordHasher(
        time_cost=3,
        memory_cost=262144,  # in KB
        parallelism=1,
        hash_len=32,
        salt_len=16,
        type=argon2.low_level.Type.I  # Argon2i
    )

    # Use low-level API for raw hash
    key = argon2.low_level.hash_secret_raw(
        secret=password_bytes,
        salt=salt_bytes,
        time_cost=3,
        memory_cost=262144,
        parallelism=1,
        hash_len=32,
        type=argon2.low_level.Type.I
    )

    return key


def decrypt_data(encrypted_data, key):
    """Decrypt data using NaCl SecretBox."""
    encrypted_bytes = bytes(encrypted_data)

    # Extract nonce (first 24 bytes) and ciphertext
    nonce_length = SecretBox.NONCE_SIZE  # 24 bytes
    if len(encrypted_bytes) < nonce_length:
        raise ValueError('Invalid encrypted data format')

    nonce = encrypted_bytes[:nonce_length]
    ciphertext = encrypted_bytes[nonce_length:]

    # Decrypt
    box = SecretBox(key)
    decrypted = box.decrypt(ciphertext, nonce)

    # Parse JSON
    return json.loads(decrypted.decode('utf-8'))


def encrypt_data(data, key):
    """Encrypt data using NaCl SecretBox."""
    # Convert data to JSON bytes
    message = json.dumps(data).encode('utf-8')

    # Generate random nonce
    nonce = utils.random(SecretBox.NONCE_SIZE)

    # Encrypt
    box = SecretBox(key)
    encrypted = box.encrypt(message, nonce)

    # The encrypt() method returns nonce + ciphertext combined
    # We need to format it as: nonce (24 bytes) + ciphertext (rest)
    # PyNaCl's encrypt already does this, we just need to extract the bytes

    # Return as list of integers for JSON storage (nonce + ciphertext)
    return list(bytes(encrypted))


def survey_to_markdown(survey):
    """Convert survey structure to markdown format."""
    markdown = f"# {survey['title']}\n"

    if survey.get('description'):
        markdown += f"{survey['description']}\n"

    markdown += "\n## Questions\n\n"

    for question in survey['questions']:
        q_type = 'yes/no' if question['type'] == 'yes_no' else 'text'
        markdown += f"- **{q_type}** {question['text']}\n"

    return markdown


def markdown_to_survey(markdown):
    """Parse markdown back into survey structure.

    CRITICAL: Impact of Adding/Removing/Reordering Questions on Exported Data
    ========================================================================

    Question IDs and Data Integrity:
    ---------------------------------
    - Questions are assigned sequential IDs: q1, q2, q3, etc. (line 227)
    - Response data is stored as a dictionary keyed by question.id (survey-parser.js:162)
    - Each response object: { "q1": {type: "yes_no", value: true}, "q2": {...}, ... }

    When you ADD a new question:
    - New question gets a new ID (e.g., q4)
    - EXISTING responses won't have data for this question
    - CSV export will show EMPTY CELLS for old responses on the new question column
    - JSON export will show the question in survey.questions but missing from old responses
    - Analysis page will correctly show "No responses for this question"

    When you REMOVE a question:
    - The question disappears from the survey structure
    - EXISTING responses STILL CONTAIN the old question data (orphaned data)
    - CSV export will NOT include the removed question (column disappears)
    - JSON export will NOT show the removed question in survey.questions
    - The encrypted response data still contains answers to deleted questions (invisible)
    - This is safe but means old data persists in the encrypted blob

    When you REORDER questions:
    - Question IDs are REGENERATED based on new order (q1, q2, q3...)
    - If you move "What is your age?" from position 1 to position 3:
    -   Old ID: q1 -> New ID: q3
    - EXISTING responses use OLD IDs, so answers will MISMATCH with questions!
    - CSV export will show WRONG DATA in columns (age answers in wrong question column)
    - JSON export will have question.id mismatch (responses have q1, survey expects q3)
    - This is a CRITICAL DATA CORRUPTION issue!

    SAFE OPERATIONS:
    ✓ Edit question text (question.id stays the same if order unchanged)
    ✓ Edit survey title or description
    ✓ Add new questions to the END (existing data unaffected)
    ✓ Change question type IF no responses exist yet

    DANGEROUS OPERATIONS:
    ✗ Reordering questions (breaks all existing responses)
    ✗ Changing question IDs manually
    ✗ Removing questions (orphans data but less severe than reordering)

    RECOMMENDATIONS:
    1. NEVER reorder questions after collecting responses
    2. To "reorder" visually: add new questions and mark old ones deprecated
    3. Consider versioning: export data BEFORE making structural changes
    4. For new surveys, structure questions carefully before launch
    5. Question IDs should be immutable UUIDs or timestamps, not sequential

    CURRENT LIMITATION:
    The markdown format doesn't preserve original question IDs, so parsing
    ALWAYS regenerates IDs based on position. This is a design flaw that
    makes question reordering destructive.
    """
    lines = markdown.split('\n')
    title = ''
    description = ''
    questions = []
    current_section = 'header'
    question_id = 1
    description_lines = []

    for line in lines:
        trimmed = line.strip()

        if not trimmed:
            if current_section == 'header' and description_lines:
                description_lines.append('')
            continue

        # Parse title
        if trimmed.startswith('# ') and not title:
            title = trimmed[2:].strip()
            continue

        # Check for Questions section
        if trimmed == '## Questions':
            current_section = 'questions'
            description = ' '.join(description_lines).replace('  ', ' ').strip()
            continue

        # Parse questions
        if current_section == 'questions' and trimmed.startswith('- **'):
            # Match: - **yes/no** text or - **text** text
            import re
            match = re.match(r'^- \*\*(yes\/no|text)\*\* (.+)$', trimmed)
            if match:
                q_type_str, text = match.groups()
                q_type = 'yes_no' if q_type_str == 'yes/no' else 'text'
                questions.append({
                    'id': f'q{question_id}',
                    'type': q_type,
                    'text': text.strip()
                })
                question_id += 1
            continue

        # Collect description
        if current_section == 'header' and not trimmed.startswith('#'):
            description_lines.append(trimmed)

    # Final description cleanup
    if current_section == 'header':
        description = ' '.join(description_lines).replace('  ', ' ').strip()

    return {
        'title': title,
        'description': description,
        'questions': questions
    }


def main():
    parser = argparse.ArgumentParser(description='Edit encrypted survey questions')
    parser.add_argument('--env', required=True, help='Path to .env file (e.g., .krvmedics)')
    parser.add_argument('--survey-id', required=True, help='Survey ID to edit')
    parser.add_argument('--editor', default='vim', help='Editor to use (default: vim)')

    args = parser.parse_args()

    # Load environment variables
    print(f"Loading configuration from {args.env}...")
    env = load_env_file(args.env)

    account_id = env.get('CLOUDFLARE_ACCOUNT_ID')
    api_token = env.get('CLOUDFLARE_API_TOKEN')
    database_name = env.get('DATABASE_NAME', 'survey-db')

    if not account_id or not api_token:
        print("Error: Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN in env file")
        sys.exit(1)

    # Get database ID
    print(f"Looking up database '{database_name}'...")
    database_id = get_database_id(account_id, api_token, database_name)
    print(f"Found database: {database_id}")

    # Fetch survey from database
    print(f"Fetching survey {args.survey_id}...")
    sql = f"SELECT * FROM surveys WHERE id = '{args.survey_id}'"
    results = cloudflare_query(account_id, api_token, database_id, sql)

    if not results:
        print(f"Error: Survey {args.survey_id} not found")
        sys.exit(1)

    survey_row = results[0]
    print(f"Survey found. Created at: {survey_row['created_at']}")

    # Get password from user
    import getpass
    password = getpass.getpass("Enter survey password: ")

    # Derive key and decrypt
    print("Deriving encryption key...")
    salt = survey_row['salt']
    key = derive_key(password, salt)

    print("Decrypting survey questions...")
    try:
        encrypted_questions = survey_row['questions']
        survey_data = decrypt_data(encrypted_questions, key)
    except Exception as e:
        print(f"Error: Failed to decrypt survey. Incorrect password? {e}")
        sys.exit(1)

    print(f"Decrypted survey: {survey_data['title']}")
    print(f"Questions: {len(survey_data['questions'])}")

    # Convert to markdown
    markdown = survey_to_markdown(survey_data)

    # Write to temp file and open in editor
    with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False, dir='/tmp', prefix=f'survey_{args.survey_id}_') as f:
        f.write(markdown)
        temp_file = f.name

    print(f"\nOpening {temp_file} in {args.editor}...")
    print("Edit the survey, save, and quit to update the database.")
    print("Press Ctrl+C to cancel without saving.\n")

    try:
        subprocess.run([args.editor, temp_file], check=True)
    except KeyboardInterrupt:
        print("\nCancelled by user.")
        os.unlink(temp_file)
        sys.exit(0)
    except subprocess.CalledProcessError:
        print("Editor exited with error. Changes not saved.")
        os.unlink(temp_file)
        sys.exit(1)

    # Read edited file
    with open(temp_file, 'r') as f:
        edited_markdown = f.read()

    os.unlink(temp_file)

    # Parse edited markdown
    print("\nParsing edited survey...")
    edited_survey = markdown_to_survey(edited_markdown)

    # Validate
    if not edited_survey['title']:
        print("Error: Survey must have a title")
        sys.exit(1)

    if not edited_survey['questions']:
        print("Error: Survey must have at least one question")
        sys.exit(1)

    print(f"Title: {edited_survey['title']}")
    print(f"Questions: {len(edited_survey['questions'])}")

    # Re-encrypt
    print("\nRe-encrypting survey...")
    encrypted_list = encrypt_data(edited_survey, key)

    # Prepare database update (not executing yet)
    print("\nPreparing database update...")

    # Create JSON string with proper escaping for SQL
    # Need to escape single quotes in JSON for SQL
    encrypted_json = json.dumps(encrypted_list).replace("'", "''")

    update_sql = f"UPDATE surveys SET questions = json('{encrypted_json}') WHERE id = '{args.survey_id}'"

    print("\n" + "="*80)
    print("DATABASE UPDATE REQUEST (NOT EXECUTED)")
    print("="*80)
    print(f"\nSQL Query:")
    print(update_sql[:500] + "..." if len(update_sql) > 500 else update_sql)
    print(f"\nEncrypted data length: {len(encrypted_list)} bytes")
    print(f"\nTo enable database updates, uncomment the cloudflare_query() call in the script.")
    print("\n" + "="*80)

    # DISABLED FOR NOW - Uncomment to enable database updates
    # try:
    #     cloudflare_query(account_id, api_token, database_id, update_sql)
    #     print("\n✓ Survey updated successfully!")
    #     print(f"  Survey ID: {args.survey_id}")
    #     print(f"  Title: {edited_survey['title']}")
    #     print(f"  Questions: {len(edited_survey['questions'])}")
    # except Exception as e:
    #     print(f"\nError updating database: {e}")
    #     sys.exit(1)

    print("\n✓ Survey changes prepared (not saved to database)")
    print(f"  Survey ID: {args.survey_id}")
    print(f"  Title: {edited_survey['title']}")
    print(f"  Questions: {len(edited_survey['questions'])}")


if __name__ == '__main__':
    main()
