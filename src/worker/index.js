/**
 * Cloudflare Worker for encrypted survey API
 */

// Import database functions
import { 
  createSurvey, 
  getSurvey, 
  getSurveyByAnalysisId,
  submitResponse, 
  getSurveyResponses, 
  getSurveyResponsesByAnalysisId,
  getSurveyStats,
  getSurveyStatsByAnalysisId,
  canAcceptResponses,
  deleteSurvey,
  deleteSurveyByAnalysisId
} from './database.js';

// Import inlined static assets
import { getFile, listFiles } from './assets.js';

// Simple ULID-like ID generator for server-side use
function generateId() {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  return (timestamp + randomPart).toUpperCase().substring(0, 26);
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

/**
 * Handle CORS preflight requests
 */
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

/**
 * Create API response with CORS headers
 */
function apiResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}

/**
 * Create error response
 */
function errorResponse(message, status = 400) {
  return apiResponse({
    success: false,
    error: message
  }, status);
}

/**
 * Handle survey creation
 */
async function handleCreateSurvey(request, env) {
  try {
    const body = await request.json();
    const { encryptedSurvey } = body;
    
    if (!encryptedSurvey) {
      return errorResponse('Missing encrypted survey data');
    }
    
    // Validate required fields
    const required = ['id', 'salt', 'encryptedData', 'keyHash', 'createdAt'];
    for (const field of required) {
      if (!encryptedSurvey[field]) {
        return errorResponse(`Missing required field: ${field}`);
      }
    }
    
    // Prepare data for database
    const surveyData = {
      id: encryptedSurvey.id,
      analysisId: generateId(), // Generate separate analysis ID
      title: '', // Will be encrypted in the encryptedData
      description: '',
      questions: encryptedSurvey.encryptedData,
      salt: encryptedSurvey.salt,
      createdAt: encryptedSurvey.createdAt,
      expiresAt: encryptedSurvey.expiresAt || null,
      maxResponses: encryptedSurvey.maxResponses || null,
      creatorKeyHash: encryptedSurvey.keyHash
    };
    
    const result = await createSurvey(env.DB, surveyData);
    
    return apiResponse({
      success: true,
      data: {
        id: result.id,
        analysisId: result.analysisId,
        url: `${request.url.split('/api')[0]}/survey/${result.id}`,
        analysisUrl: `${request.url.split('/api')[0]}/analyze/${result.analysisId}`
      }
    });
    
  } catch (error) {
    console.error('Create survey error:', error);
    return errorResponse(error.message, 500);
  }
}

/**
 * Handle getting survey data
 */
async function handleGetSurvey(surveyId, env) {
  try {
    const survey = await getSurvey(env.DB, surveyId);
    
    if (!survey) {
      return errorResponse('Survey not found', 404);
    }
    
    // Return encrypted survey data
    return apiResponse({
      success: true,
      data: {
        id: survey.id,
        salt: survey.salt,
        encryptedData: survey.questions,
        keyHash: survey.creatorKeyHash,
        createdAt: survey.createdAt,
        expiresAt: survey.expiresAt,
        maxResponses: survey.maxResponses
      }
    });
    
  } catch (error) {
    console.error('Get survey error:', error);
    return errorResponse(error.message, 500);
  }
}

/**
 * Handle getting survey data by analysis ID
 */
async function handleGetSurveyByAnalysisId(analysisId, env) {
  try {
    const survey = await getSurveyByAnalysisId(env.DB, analysisId);
    
    if (!survey) {
      return errorResponse('Survey not found', 404);
    }
    
    // Return encrypted survey data
    return apiResponse({
      success: true,
      data: {
        id: survey.id,
        salt: survey.salt,
        encryptedData: survey.questions,
        keyHash: survey.creatorKeyHash,
        createdAt: survey.createdAt,
        expiresAt: survey.expiresAt,
        maxResponses: survey.maxResponses
      }
    });
    
  } catch (error) {
    console.error('Get survey by analysis ID error:', error);
    return errorResponse(error.message, 500);
  }
}

/**
 * Handle response submission
 */
async function handleSubmitResponse(surveyId, request, env) {
  try {
    const body = await request.json();
    const { encryptedResponse } = body;
    
    if (!encryptedResponse) {
      return errorResponse('Missing encrypted response data');
    }
    
    // Validate required fields
    if (!encryptedResponse.id || !encryptedResponse.encryptedAnswers) {
      return errorResponse('Missing required response fields');
    }
    
    // Check if survey can accept responses
    const canAccept = await canAcceptResponses(env.DB, surveyId);
    if (!canAccept.canAccept) {
      return errorResponse(canAccept.reason, 400);
    }
    
    const responseData = {
      id: encryptedResponse.id,
      surveyId: surveyId,
      answers: encryptedResponse.encryptedAnswers,
      submittedAt: Date.now()
    };
    
    const result = await submitResponse(env.DB, responseData);
    
    return apiResponse({
      success: true,
      data: { id: result.id }
    });
    
  } catch (error) {
    console.error('Submit response error:', error);
    return errorResponse(error.message, 500);
  }
}

/**
 * Handle getting survey responses (for creator)
 */
async function handleGetResponses(surveyId, request, env) {
  try {
    const url = new URL(request.url);
    const keyHash = url.searchParams.get('keyHash');
    
    if (!keyHash) {
      return errorResponse('Missing authorization key hash', 401);
    }
    
    const responses = await getSurveyResponses(env.DB, surveyId, keyHash);
    const stats = await getSurveyStats(env.DB, surveyId, keyHash);
    
    return apiResponse({
      success: true,
      data: {
        responses,
        stats
      }
    });
    
  } catch (error) {
    console.error('Get responses error:', error);
    
    if (error.message.includes('Unauthorized')) {
      return errorResponse(error.message, 401);
    }
    
    return errorResponse(error.message, 500);
  }
}

/**
 * Handle getting survey responses by analysis ID (creator only)
 */
async function handleGetResponsesByAnalysisId(analysisId, request, env) {
  try {
    const url = new URL(request.url);
    const keyHash = url.searchParams.get('keyHash');
    
    if (!keyHash) {
      return errorResponse('Missing authorization key hash', 401);
    }
    
    const responses = await getSurveyResponsesByAnalysisId(env.DB, analysisId, keyHash);
    const stats = await getSurveyStatsByAnalysisId(env.DB, analysisId, keyHash);
    
    return apiResponse({
      success: true,
      data: {
        responses,
        stats
      }
    });
    
  } catch (error) {
    console.error('Get responses by analysis ID error:', error);
    
    if (error.message.includes('Unauthorized')) {
      return errorResponse(error.message, 401);
    }
    
    return errorResponse(error.message, 500);
  }
}

/**
 * Handle survey deletion by analysis ID (creator only)
 */
async function handleDeleteSurveyByAnalysisId(analysisId, request, env) {
  try {
    const url = new URL(request.url);
    const keyHash = url.searchParams.get('keyHash');
    
    if (!keyHash) {
      return errorResponse('Missing authorization key hash', 401);
    }
    
    const result = await deleteSurveyByAnalysisId(env.DB, analysisId, keyHash);
    
    return apiResponse({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Delete survey by analysis ID error:', error);
    
    if (error.message.includes('Unauthorized') || error.message.includes('not found')) {
      return errorResponse(error.message, 401);
    }
    
    return errorResponse(error.message, 500);
  }
}

/**
 * Handle survey deletion (creator only)
 */
async function handleDeleteSurvey(surveyId, request, env) {
  try {
    const url = new URL(request.url);
    const keyHash = url.searchParams.get('keyHash');
    
    if (!keyHash) {
      return errorResponse('Missing authorization key hash', 401);
    }
    
    const result = await deleteSurvey(env.DB, surveyId, keyHash);
    
    return apiResponse({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Delete survey error:', error);
    
    if (error.message.includes('Unauthorized') || error.message.includes('not found')) {
      return errorResponse(error.message, 401);
    }
    
    return errorResponse(error.message, 500);
  }
}

/**
 * Route requests
 */
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  
  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return handleOptions();
  }
  
  // API routes
  if (path.startsWith('/api/')) {
    // POST /api/survey - Create survey
    if (path === '/api/survey' && method === 'POST') {
      return handleCreateSurvey(request, env);
    }
    
    // GET /api/survey/:id - Get survey data
    const surveyMatch = path.match(/^\/api\/survey\/([a-zA-Z0-9]+)$/);
    if (surveyMatch && method === 'GET') {
      return handleGetSurvey(surveyMatch[1], env);
    }
    
    // POST /api/survey/:id/response - Submit response
    const responseMatch = path.match(/^\/api\/survey\/([a-zA-Z0-9]+)\/response$/);
    if (responseMatch && method === 'POST') {
      return handleSubmitResponse(responseMatch[1], request, env);
    }
    
    // GET /api/survey/:id/responses - Get responses (creator only)
    const responsesMatch = path.match(/^\/api\/survey\/([a-zA-Z0-9]+)\/responses$/);
    if (responsesMatch && method === 'GET') {
      return handleGetResponses(responsesMatch[1], request, env);
    }
    
    // DELETE /api/survey/:id - Delete survey (creator only)
    const deleteMatch = path.match(/^\/api\/survey\/([a-zA-Z0-9]+)$/);
    if (deleteMatch && method === 'DELETE') {
      return handleDeleteSurvey(deleteMatch[1], request, env);
    }
    
    // Analysis endpoints (using analysis ID)
    // GET /api/analysis/:id/survey - Get survey data by analysis ID
    const analysisSurveyMatch = path.match(/^\/api\/analysis\/([a-zA-Z0-9]+)\/survey$/);
    if (analysisSurveyMatch && method === 'GET') {
      return handleGetSurveyByAnalysisId(analysisSurveyMatch[1], env);
    }
    
    // GET /api/analysis/:id/responses - Get responses by analysis ID (creator only)
    const analysisResponsesMatch = path.match(/^\/api\/analysis\/([a-zA-Z0-9]+)\/responses$/);
    if (analysisResponsesMatch && method === 'GET') {
      return handleGetResponsesByAnalysisId(analysisResponsesMatch[1], request, env);
    }
    
    // DELETE /api/analysis/:id - Delete survey by analysis ID (creator only)
    const analysisDeleteMatch = path.match(/^\/api\/analysis\/([a-zA-Z0-9]+)$/);
    if (analysisDeleteMatch && method === 'DELETE') {
      return handleDeleteSurveyByAnalysisId(analysisDeleteMatch[1], request, env);
    }
    
    return errorResponse('API endpoint not found', 404);
  }
  
  // Serve shared JavaScript modules
  if (path.startsWith('/src/shared/')) {
    return serveStaticFile(path, env);
  }
  
  // Serve static files (frontend)
  return serveStaticFile(path, env);
}

/**
 * Serve static frontend files
 */
async function serveStaticFile(path, env) {
  // Default to index.html
  if (path === '/') {
    path = '/index.html';
  }
  
  // Route frontend paths to appropriate HTML files
  if (path.startsWith('/survey/')) {
    path = '/survey.html';
  } else if (path.startsWith('/create')) {
    path = '/create.html';
  } else if (path.startsWith('/analyze/')) {
    path = '/analyze.html';
  }
  
  try {
    // Try to get the file from inlined assets
    const file = getFile(path);
    
    if (file) {
      return new Response(file.content, {
        headers: { 
          'Content-Type': file.contentType,
          'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
        }
      });
    }
    
    // File not found
    return new Response('File not found', { 
      status: 404,
      headers: { 'Content-Type': 'text/plain' }
    });
    
  } catch (error) {
    console.error('Error serving static file:', error);
    return new Response('Internal server error', { 
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}


/**
 * Main worker export
 */
export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse('Internal server error', 500);
    }
  }
};