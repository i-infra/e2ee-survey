/**
 * Database operations for D1
 */

/**
 * Create a new survey in the database
 */
export async function createSurvey(db, surveyData) {
  const {
    id,
    analysisId,
    title,
    description,
    questions,
    salt,
    createdAt,
    expiresAt,
    maxResponses,
    creatorKeyHash
  } = surveyData;
  
  const stmt = db.prepare(`
    INSERT INTO surveys (
      id, analysis_id, title, description, questions, salt, 
      created_at, expires_at, max_responses, creator_key_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = await stmt.bind(
    id,
    analysisId,
    title,
    description,
    new Uint8Array(questions),
    new Uint8Array(salt),
    createdAt,
    expiresAt,
    maxResponses,
    creatorKeyHash
  ).run();
  
  if (!result.success) {
    throw new Error('Failed to create survey');
  }
  
  return { id, analysisId, success: true };
}

/**
 * Get a survey by ID
 */
export async function getSurvey(db, surveyId) {
  const stmt = db.prepare('SELECT * FROM surveys WHERE id = ?');
  const result = await stmt.bind(surveyId).first();
  
  if (!result) {
    return null;
  }
  
  return {
    id: result.id,
    title: result.title,
    description: result.description,
    questions: Array.from(new Uint8Array(result.questions)),
    salt: Array.from(new Uint8Array(result.salt)),
    createdAt: result.created_at,
    expiresAt: result.expires_at,
    maxResponses: result.max_responses,
    creatorKeyHash: result.creator_key_hash
  };
}

/**
 * Check if a survey is still accepting responses
 */
export async function canAcceptResponses(db, surveyId) {
  const survey = await getSurvey(db, surveyId);
  
  if (!survey) {
    return { canAccept: false, reason: 'Survey not found' };
  }
  
  // Check expiration
  if (survey.expiresAt && Date.now() > survey.expiresAt) {
    return { canAccept: false, reason: 'Survey has expired' };
  }
  
  // Check response limit
  if (survey.maxResponses) {
    const responseCount = await getResponseCount(db, surveyId);
    if (responseCount >= survey.maxResponses) {
      return { canAccept: false, reason: 'Survey has reached maximum responses' };
    }
  }
  
  return { canAccept: true, survey };
}

/**
 * Submit a response to a survey
 */
export async function submitResponse(db, responseData) {
  const { id, surveyId, answers, submittedAt } = responseData;
  
  // Check if survey can accept responses
  const canAccept = await canAcceptResponses(db, surveyId);
  if (!canAccept.canAccept) {
    throw new Error(canAccept.reason);
  }
  
  const stmt = db.prepare(`
    INSERT INTO responses (id, survey_id, answers, submitted_at)
    VALUES (?, ?, ?, ?)
  `);
  
  const result = await stmt.bind(
    id,
    surveyId,
    new Uint8Array(answers),
    submittedAt
  ).run();
  
  if (!result.success) {
    throw new Error('Failed to submit response');
  }
  
  return { id, success: true };
}

/**
 * Get a survey by analysis ID (for analysis endpoints)
 */
export async function getSurveyByAnalysisId(db, analysisId) {
  const survey = await db.prepare(`
    SELECT * FROM surveys WHERE analysis_id = ?
  `).bind(analysisId).first();
  
  if (!survey) {
    return null;
  }
  
  return {
    id: survey.id,
    analysisId: survey.analysis_id,
    title: survey.title,
    description: survey.description,
    questions: Array.from(new Uint8Array(survey.questions)),
    salt: Array.from(new Uint8Array(survey.salt)),
    createdAt: survey.created_at,
    expiresAt: survey.expires_at,
    maxResponses: survey.max_responses,
    creatorKeyHash: survey.creator_key_hash
  };
}

/**
 * Get all responses for a survey (by analysis ID)
 */
export async function getSurveyResponsesByAnalysisId(db, analysisId, creatorKeyHash) {
  // Verify the requester is the survey creator
  const survey = await getSurveyByAnalysisId(db, analysisId);
  
  if (!survey) {
    throw new Error('Survey not found');
  }
  
  if (survey.creatorKeyHash !== creatorKeyHash) {
    throw new Error('Unauthorized - incorrect creator key');
  }
  
  // Get all responses for this survey
  const responses = await db.prepare(`
    SELECT * FROM responses WHERE survey_id = ? ORDER BY submitted_at DESC
  `).bind(survey.id).all();
  
  return responses.results.map(response => ({
    id: response.id,
    answers: Array.from(new Uint8Array(response.answers)),
    submittedAt: response.submitted_at
  }));
}

/**
 * Get all responses for a survey (by survey ID - for backwards compatibility)
 */
export async function getSurveyResponses(db, surveyId, creatorKeyHash) {
  // Verify the requester is the survey creator
  const survey = await getSurvey(db, surveyId);
  
  if (!survey) {
    throw new Error('Survey not found');
  }
  
  if (survey.creatorKeyHash !== creatorKeyHash) {
    throw new Error('Unauthorized - incorrect creator key');
  }
  
  const stmt = db.prepare(`
    SELECT id, answers, submitted_at 
    FROM responses 
    WHERE survey_id = ? 
    ORDER BY submitted_at ASC
  `);
  
  const results = await stmt.bind(surveyId).all();
  
  return results.results.map(row => ({
    id: row.id,
    answers: Array.from(new Uint8Array(row.answers)),
    submittedAt: row.submitted_at
  }));
}

/**
 * Get response count for a survey
 */
export async function getResponseCount(db, surveyId) {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM responses WHERE survey_id = ?');
  const result = await stmt.bind(surveyId).first();
  return result.count;
}

/**
 * Get survey statistics (by analysis ID)
 */
export async function getSurveyStatsByAnalysisId(db, analysisId, creatorKeyHash) {
  // Verify the requester is the survey creator
  const survey = await getSurveyByAnalysisId(db, analysisId);
  
  if (!survey) {
    throw new Error('Survey not found');
  }
  
  if (survey.creatorKeyHash !== creatorKeyHash) {
    throw new Error('Unauthorized - incorrect creator key');
  }
  
  const responseCount = await getResponseCount(db, survey.id);
  
  return {
    surveyId: survey.id,
    analysisId: survey.analysisId,
    responseCount,
    createdAt: survey.createdAt,
    expiresAt: survey.expiresAt,
    maxResponses: survey.maxResponses,
    isExpired: survey.expiresAt ? Date.now() > survey.expiresAt : false,
    isAtLimit: survey.maxResponses ? responseCount >= survey.maxResponses : false
  };
}

/**
 * Get survey statistics (by survey ID - for backwards compatibility)
 */
export async function getSurveyStats(db, surveyId, creatorKeyHash) {
  // Verify the requester is the survey creator
  const survey = await getSurvey(db, surveyId);
  
  if (!survey) {
    throw new Error('Survey not found');
  }
  
  if (survey.creatorKeyHash !== creatorKeyHash) {
    throw new Error('Unauthorized - incorrect creator key');
  }
  
  const responseCount = await getResponseCount(db, surveyId);
  
  return {
    surveyId,
    responseCount,
    createdAt: survey.createdAt,
    expiresAt: survey.expiresAt,
    maxResponses: survey.maxResponses,
    isExpired: survey.expiresAt ? Date.now() > survey.expiresAt : false,
    isAtLimit: survey.maxResponses ? responseCount >= survey.maxResponses : false
  };
}

/**
 * Delete old surveys (cleanup job)
 */
export async function cleanupExpiredSurveys(db, maxAge = 30 * 24 * 60 * 60 * 1000) {
  const cutoffTime = Date.now() - maxAge;
  
  // Delete responses first (foreign key constraint)
  await db.prepare(`
    DELETE FROM responses 
    WHERE survey_id IN (
      SELECT id FROM surveys WHERE created_at < ?
    )
  `).bind(cutoffTime).run();
  
  // Delete surveys
  const result = await db.prepare(`
    DELETE FROM surveys WHERE created_at < ?
  `).bind(cutoffTime).run();
  
  return { deletedCount: result.changes };
}

/**
 * Delete a survey and all its responses (creator only, by analysis ID)
 */
export async function deleteSurveyByAnalysisId(db, analysisId, creatorKeyHash) {
  // First verify the creator and get survey ID
  const survey = await db.prepare(`
    SELECT id, creator_key_hash FROM surveys WHERE analysis_id = ?
  `).bind(analysisId).first();
  
  if (!survey) {
    throw new Error('Survey not found');
  }
  
  if (survey.creator_key_hash !== creatorKeyHash) {
    throw new Error('Unauthorized - only survey creator can delete');
  }
  
  // Delete responses first (foreign key constraint)
  const responseResult = await db.prepare(`
    DELETE FROM responses WHERE survey_id = ?
  `).bind(survey.id).run();
  
  // Delete the survey
  const surveyResult = await db.prepare(`
    DELETE FROM surveys WHERE id = ?
  `).bind(survey.id).run();
  
  if (surveyResult.changes === 0) {
    throw new Error('Survey not found or already deleted');
  }
  
  return {
    deletedSurvey: true,
    deletedResponses: responseResult.changes
  };
}

/**
 * Delete a survey and all its responses (creator only, by survey ID - for backwards compatibility)
 */
export async function deleteSurvey(db, surveyId, creatorKeyHash) {
  // First verify the creator
  const survey = await db.prepare(`
    SELECT creator_key_hash FROM surveys WHERE id = ?
  `).bind(surveyId).first();
  
  if (!survey) {
    throw new Error('Survey not found');
  }
  
  if (survey.creator_key_hash !== creatorKeyHash) {
    throw new Error('Unauthorized - only survey creator can delete');
  }
  
  // Delete responses first (foreign key constraint)
  const responseResult = await db.prepare(`
    DELETE FROM responses WHERE survey_id = ?
  `).bind(surveyId).run();
  
  // Delete the survey
  const surveyResult = await db.prepare(`
    DELETE FROM surveys WHERE id = ?
  `).bind(surveyId).run();
  
  if (surveyResult.changes === 0) {
    throw new Error('Survey not found or already deleted');
  }
  
  return {
    deletedSurvey: true,
    deletedResponses: responseResult.changes
  };
}