/**
 * Markdown parser for survey definitions
 */

/**
 * Parse survey markdown into structured data
 */
export function parseSurveyMarkdown(markdown) {
  const lines = markdown.split('\n');
  let title = '';
  let description = '';
  const questions = [];
  let currentSection = 'header';
  let questionId = 1;
  let descriptionLines = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) {
      if (currentSection === 'header' && descriptionLines.length > 0) {
        descriptionLines.push(''); // Preserve paragraph breaks
      }
      continue;
    }
    
    // Parse title (first # heading)
    if (trimmed.startsWith('# ') && !title) {
      title = trimmed.slice(2).trim();
      continue;
    }
    
    // Check for Questions section
    if (trimmed === '## Questions') {
      currentSection = 'questions';
      // Join description lines and clean up
      description = descriptionLines
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      continue;
    }
    
    // Parse questions
    if (currentSection === 'questions' && trimmed.startsWith('- **')) {
      const match = trimmed.match(/^- \*\*(yes\/no|text)\*\* (.+)$/);
      if (match) {
        const [, type, text] = match;
        questions.push({
          id: `q${questionId++}`,
          type: type === 'yes/no' ? 'yes_no' : 'text',
          text: text.trim()
        });
      }
      continue;
    }
    
    // Collect description (everything between title and Questions)
    if (currentSection === 'header' && !trimmed.startsWith('#')) {
      descriptionLines.push(trimmed);
    }
  }
  
  // Final description cleanup if we never hit Questions section
  if (currentSection === 'header') {
    description = descriptionLines
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  return { title, description, questions };
}

/**
 * Validate parsed survey data
 */
export function validateSurvey(survey) {
  const errors = [];
  
  // Check title
  if (!survey.title || survey.title.trim().length === 0) {
    errors.push('Survey must have a title');
  } else if (survey.title.length > 200) {
    errors.push('Survey title must be less than 200 characters');
  }
  
  // Check description
  if (survey.description && survey.description.length > 1000) {
    errors.push('Survey description must be less than 1000 characters');
  }
  
  // Check questions
  if (!survey.questions || survey.questions.length === 0) {
    errors.push('Survey must have at least one question');
  } else if (survey.questions.length > 50) {
    errors.push('Survey cannot have more than 50 questions');
  }
  
  // Validate each question
  survey.questions.forEach((question, index) => {
    if (!question.text || question.text.trim().length === 0) {
      errors.push(`Question ${index + 1} cannot be empty`);
    } else if (question.text.length > 500) {
      errors.push(`Question ${index + 1} must be less than 500 characters`);
    }
    
    if (!['yes_no', 'text'].includes(question.type)) {
      errors.push(`Question ${index + 1} has invalid type: ${question.type}`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Generate example survey markdown
 */
export function getExampleSurvey() {
  return `# Customer Feedback Survey
We'd love to hear your thoughts about our service. All responses are anonymous and encrypted.

## Questions

- **yes/no** Are you satisfied with our service?
- **text** What could we improve?
- **yes/no** Would you recommend us to a friend?
- **text** Any additional comments?`;
}

/**
 * Convert survey back to markdown (for editing)
 */
export function surveyToMarkdown(survey) {
  let markdown = `# ${survey.title}\n`;
  
  if (survey.description) {
    markdown += `${survey.description}\n`;
  }
  
  markdown += '\n## Questions\n\n';
  
  survey.questions.forEach(question => {
    const type = question.type === 'yes_no' ? 'yes/no' : 'text';
    markdown += `- **${type}** ${question.text}\n`;
  });
  
  return markdown;
}

/**
 * Create response structure for a survey
 */
export function createResponseStructure(survey) {
  const responses = {};
  
  survey.questions.forEach(question => {
    responses[question.id] = {
      type: question.type,
      value: question.type === 'yes_no' ? null : ''
    };
  });
  
  return responses;
}

/**
 * Validate survey responses
 */
export function validateResponses(survey, responses) {
  const errors = [];
  
  // Check that all required questions are answered
  survey.questions.forEach(question => {
    const response = responses[question.id];
    
    if (!response) {
      errors.push(`Missing response for question: ${question.text}`);
      return;
    }
    
    if (question.type === 'yes_no') {
      if (response.value !== true && response.value !== false && response.value !== null) {
        errors.push(`Invalid yes/no response for: ${question.text}`);
      }
    } else if (question.type === 'text') {
      if (typeof response.value !== 'string') {
        errors.push(`Invalid text response for: ${question.text}`);
      } else if (response.value.length > 5000) {
        errors.push(`Text response too long for: ${question.text} (max 5000 characters)`);
      }
    }
  });
  
  return {
    valid: errors.length === 0,
    errors
  };
}