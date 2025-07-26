// netlify/edge-functions/api/accounts.js

import { Context } from 'https://edge.netlify.com';
import { Client } from 'https://deno.land/x/postgres@v0.17.0/mod.ts'; // PostgreSQL client for Deno

// Get your Neon DB connection string from Netlify environment variables.
// This variable (e.g., NEON_DATABASE_URL) must be set in your Netlify site settings.
const DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");

export default async (request, context) => {
    const { pathname } = new URL(request.url);

    // This Edge Function only handles requests for paths starting with /api/accounts
    if (!pathname.startsWith('/api/accounts')) {
        return context.next(); // Let other requests pass through Netlify's default handling
    }

    // Initialize the PostgreSQL client and connect to the database
    let client;
    try {
        if (!DATABASE_URL) {
            // Log an error if the environment variable is missing
            console.error("NEON_DATABASE_URL environment variable is not set. Cannot connect to database.");
            return new Response(JSON.stringify({ error: 'Database connection configuration missing.' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 500,
            });
        }
        client = new Client(DATABASE_URL);
        await client.connect();
    } catch (dbConnectError) {
        console.error('Database connection error during request:', dbConnectError);
        return new Response(JSON.stringify({ error: 'Failed to connect to database', details: dbConnectError.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
        });
    }

    try {
        switch (request.method) {
            case 'GET':
                // Retrieve all accounts from the database, ordered by name
                const result = await client.queryObject`SELECT id, name, type, labelText FROM accounts ORDER BY name ASC`;
                return new Response(JSON.stringify(result.rows || []), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200,
                });

            case 'POST':
                // This POST endpoint is designed to receive the *entire* current array of accounts
                // from the frontend and replace the database content with it.
                const accountsToSave = await request.json();

                // Basic validation: ensure the received data is an array
                if (!Array.isArray(accountsToSave)) {
                    return new Response(JSON.stringify({ error: 'Request body must be an array of accounts.' }), {
                        headers: { 'Content-Type': 'application/json' },
                        status: 400,
                    });
                }

                // Start a database transaction to ensure data consistency
                await client.queryArray`BEGIN`;
                try {
                    // 1. Delete all existing accounts
                    await client.queryArray`DELETE FROM accounts`;

                    // 2. Insert all new accounts from the received array
                    for (const account of accountsToSave) {
                        // Basic data validation for each account object
                        if (!account.id || !account.name || !account.type) {
                            console.warn('Skipping invalid account during POST operation (missing id, name, or type):', account);
                            continue; // Skip accounts that don't have required fields
                        }
                        await client.queryArray`INSERT INTO accounts (id, name, type, labelText) VALUES (${account.id}, ${account.name}, ${account.type}, ${account.labelText || null})`;
                    }
                    await client.queryArray`COMMIT`; // Commit the transaction if all insertions are successful

                    return new Response(JSON.stringify({ message: 'Accounts updated successfully in Neon DB' }), {
                        headers: { 'Content-Type': 'application/json' },
                        status: 200,
                    });
                } catch (transactionError) {
                    await client.queryArray`ROLLBACK`; // Rollback the transaction if any error occurs
                    console.error('Transaction failed during POST operation:', transactionError);
                    return new Response(JSON.stringify({ error: 'Failed to save accounts due to database transaction error', details: transactionError.message }), {
                        headers: { 'Content-Type': 'application/json' },
                        status: 500,
                    });
                }

            default:
                // Return 405 Method Not Allowed for any other HTTP methods
                return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
        }
    } catch (error) {
        console.error('API endpoint error:', error);
        return new Response(JSON.stringify({ error: 'An unexpected error occurred processing the request', details: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
        });
    } finally {
        // Ensure the database client connection is always closed
        if (client) {
            await client.end();
        }
    }
};
