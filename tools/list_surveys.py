#!/usr/bin/env python3
"""
List all surveys in the Cloudflare D1 database

Usage:
    ./list_surveys.py --env .krvmedics
"""

import argparse
import sys
from datetime import datetime
from edit_survey import load_env_file, get_database_id, cloudflare_query


def format_timestamp(ts):
    """Format Unix timestamp to readable date."""
    try:
        return datetime.fromtimestamp(ts / 1000).strftime('%Y-%m-%d %H:%M:%S')
    except:
        return str(ts)


def main():
    parser = argparse.ArgumentParser(description='List all surveys')
    parser.add_argument('--env', required=True, help='Path to .env file (e.g., .krvmedics)')

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
    print(f"Looking up database '{database_name}'...\n")
    database_id = get_database_id(account_id, api_token, database_name)

    # Fetch all surveys
    sql = "SELECT id, analysis_id, created_at, expires_at, max_responses, creator_key_hash FROM surveys ORDER BY created_at DESC"
    results = cloudflare_query(account_id, api_token, database_id, sql)

    if not results:
        print("No surveys found.")
        return

    print(f"Found {len(results)} survey(s):\n")
    print("=" * 100)

    for i, survey in enumerate(results, 1):
        print(f"\n{i}. Survey ID: {survey['id']}")
        print(f"   Results Access Code: {survey['analysis_id']}")
        print(f"   Created: {format_timestamp(survey['created_at'])}")

        if survey.get('expires_at'):
            print(f"   Expires: {format_timestamp(survey['expires_at'])}")
        else:
            print(f"   Expires: Never")

        if survey.get('max_responses'):
            print(f"   Max Responses: {survey['max_responses']}")
        else:
            print(f"   Max Responses: Unlimited")

        print(f"   Creator Key Hash: {survey['creator_key_hash'][:16]}...")

    print("\n" + "=" * 100)

    # Also count responses for each survey
    print("\nResponse counts:")
    for i, survey in enumerate(results, 1):
        sql = f"SELECT COUNT(*) as count FROM responses WHERE survey_id = '{survey['id']}'"
        count_result = cloudflare_query(account_id, api_token, database_id, sql)
        count = count_result[0]['count'] if count_result else 0
        print(f"  {survey['id']}: {count} response(s)")

    print()


if __name__ == '__main__':
    main()
