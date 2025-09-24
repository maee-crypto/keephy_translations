#!/usr/bin/env node

/**
 * Keephy Translations Service
 * Manages internationalization, translations, and localization
 */

import express from 'express';
import mongoose from 'mongoose';
import pino from 'pino';
import pinoHttp from 'pino-http';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';

// Import models
import Translation from './models/Translation.js';
import Glossary from './models/Glossary.js';

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
const PORT = process.env.PORT || 3010;

// Middleware
app.use(helmet());
app.use(cors());
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '10mb' }));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/keephy_enhanced';

mongoose.connect(MONGODB_URI)
  .then(() => logger.info('Connected to MongoDB'))
  .catch(err => logger.error('MongoDB connection error:', err));

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'keephy_translations',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/ready', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'ready', service: 'keephy_translations' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: error.message });
  }
});

// =============================================================================
// TRANSLATION ROUTES
// =============================================================================

// Get translation bundles
app.get('/api/i18n/:namespace', async (req, res) => {
  try {
    const { namespace } = req.params;
    const { locales = 'en', status = 'published' } = req.query;
    
    const localeArray = locales.split(',');
    const bundles = await Translation.getBundles([namespace], localeArray, status);
    
    // Group by locale
    const result = {};
    localeArray.forEach(locale => {
      result[locale] = {};
      bundles
        .filter(b => b.locale === locale)
        .forEach(bundle => {
          result[locale][bundle.key] = bundle.value;
        });
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching translation bundles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch translation bundles'
    });
  }
});

// Get multiple namespaces
app.get('/api/i18n', async (req, res) => {
  try {
    const { namespaces = 'ui,emails', locales = 'en', status = 'published' } = req.query;
    
    const namespaceArray = namespaces.split(',');
    const localeArray = locales.split(',');
    const bundles = await Translation.getBundles(namespaceArray, localeArray, status);
    
    // Group by namespace and locale
    const result = {};
    namespaceArray.forEach(namespace => {
      result[namespace] = {};
      localeArray.forEach(locale => {
        result[namespace][locale] = {};
        bundles
          .filter(b => b.namespace === namespace && b.locale === locale)
          .forEach(bundle => {
            result[namespace][locale][bundle.key] = bundle.value;
          });
      });
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching translation bundles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch translation bundles'
    });
  }
});

// Create or update translation
app.post('/api/i18n/keys', async (req, res) => {
  try {
    const {
      namespace,
      key,
      translations,
      context,
      variables = [],
      createdBy = 'system'
    } = req.body;
    
    const results = [];
    
    for (const [locale, value] of Object.entries(translations)) {
      const translation = await Translation.findOneAndUpdate(
        { namespace, key, locale },
        {
          namespace,
          key,
          locale,
          value,
          context,
          variables,
          'metadata.createdBy': createdBy,
          status: 'draft'
        },
        { upsert: true, new: true }
      );
      
      results.push(translation);
    }
    
    res.status(201).json({
      success: true,
      data: results
    });
  } catch (error) {
    logger.error('Error creating/updating translations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create/update translations'
    });
  }
});

// Get translation by key
app.get('/api/i18n/:namespace/:key', async (req, res) => {
  try {
    const { namespace, key } = req.params;
    const { locales = 'en' } = req.query;
    
    const localeArray = locales.split(',');
    const translations = await Translation.find({
      namespace,
      key,
      locale: { $in: localeArray },
      isActive: true
    }).sort({ locale: 1 });
    
    const result = {};
    translations.forEach(translation => {
      result[translation.locale] = {
        value: translation.value,
        context: translation.context,
        status: translation.status,
        variables: translation.variables
      };
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error fetching translation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch translation'
    });
  }
});

// Update translation
app.put('/api/i18n/:namespace/:key/:locale', async (req, res) => {
  try {
    const { namespace, key, locale } = req.params;
    const { value, context, variables, status, updatedBy = 'system' } = req.body;
    
    const translation = await Translation.findOneAndUpdate(
      { namespace, key, locale },
      {
        value,
        context,
        variables,
        status: status || 'draft',
        'metadata.createdBy': updatedBy
      },
      { new: true }
    );
    
    if (!translation) {
      return res.status(404).json({
        success: false,
        error: 'Translation not found'
      });
    }
    
    res.json({
      success: true,
      data: translation
    });
  } catch (error) {
    logger.error('Error updating translation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update translation'
    });
  }
});

// Publish translations
app.post('/api/i18n/publish', async (req, res) => {
  try {
    const { namespace, keys, publishedBy = 'system' } = req.body;
    
    const result = await Translation.updateMany(
      { 
        namespace, 
        key: { $in: keys },
        status: { $in: ['draft', 'reviewed'] }
      },
      { 
        status: 'published',
        'metadata.publishedAt': new Date(),
        'metadata.createdBy': publishedBy
      }
    );
    
    res.json({
      success: true,
      data: {
        modifiedCount: result.modifiedCount
      }
    });
  } catch (error) {
    logger.error('Error publishing translations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to publish translations'
    });
  }
});

// =============================================================================
// GLOSSARY ROUTES
// =============================================================================

// Get tenant glossary
app.get('/api/glossary/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { locale = 'en', category, limit = 100, offset = 0 } = req.query;
    
    let filter = { tenantId, isActive: true };
    if (category) filter.category = category;
    
    const glossary = await Glossary.find(filter)
      .sort({ 'metadata.usageCount': -1, term: 1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));
    
    // Apply locale filtering
    const result = glossary.map(item => ({
      term: item.term,
      translation: item.getTranslation(locale),
      category: item.category,
      context: item.translations.find(t => t.locale === locale)?.context || '',
      usageCount: item.metadata.usageCount
    }));
    
    res.json({
      success: true,
      data: result,
      count: result.length
    });
  } catch (error) {
    logger.error('Error fetching glossary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch glossary'
    });
  }
});

// Search glossary terms
app.get('/api/glossary/:tenantId/search', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { q, limit = 20 } = req.query;
    
    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }
    
    const results = await Glossary.searchTerms(tenantId, q, parseInt(limit));
    
    res.json({
      success: true,
      data: results,
      count: results.length
    });
  } catch (error) {
    logger.error('Error searching glossary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search glossary'
    });
  }
});

// Create glossary term
app.post('/api/glossary/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const {
      term,
      translations,
      category = 'business',
      businessId,
      createdBy = 'system'
    } = req.body;
    
    const glossary = new Glossary({
      tenantId,
      businessId,
      term,
      translations,
      category,
      'metadata.createdBy': createdBy
    });
    
    await glossary.save();
    
    res.status(201).json({
      success: true,
      data: glossary
    });
  } catch (error) {
    logger.error('Error creating glossary term:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create glossary term'
    });
  }
});

// Update glossary term
app.put('/api/glossary/:tenantId/:termId', async (req, res) => {
  try {
    const { tenantId, termId } = req.params;
    const { translations, category, updatedBy = 'system' } = req.body;
    
    const glossary = await Glossary.findOneAndUpdate(
      { _id: termId, tenantId },
      {
        translations,
        category,
        'metadata.createdBy': updatedBy
      },
      { new: true }
    );
    
    if (!glossary) {
      return res.status(404).json({
        success: false,
        error: 'Glossary term not found'
      });
    }
    
    res.json({
      success: true,
      data: glossary
    });
  } catch (error) {
    logger.error('Error updating glossary term:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update glossary term'
    });
  }
});

// =============================================================================
// TRANSLATION STATISTICS ROUTES
// =============================================================================

// Get translation statistics
app.get('/api/i18n/stats/:namespace', async (req, res) => {
  try {
    const { namespace } = req.params;
    const { locale = 'en' } = req.query;
    
    const stats = await Translation.getTranslationStats(namespace, locale);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error fetching translation statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch translation statistics'
    });
  }
});

// Get missing translations
app.get('/api/i18n/missing/:namespace', async (req, res) => {
  try {
    const { namespace } = req.params;
    const { locales = 'en,ar,es,fr' } = req.query;
    
    const localeArray = locales.split(',');
    const missing = await Translation.getMissingKeys(namespace, localeArray);
    
    res.json({
      success: true,
      data: missing
    });
  } catch (error) {
    logger.error('Error fetching missing translations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch missing translations'
    });
  }
});

// =============================================================================
// MACHINE TRANSLATION ROUTES
// =============================================================================

// Translate text using machine translation
app.post('/api/i18n/translate', async (req, res) => {
  try {
    const { text, sourceLocale = 'en', targetLocales = ['ar', 'es', 'fr'], namespace = 'ui' } = req.body;
    
    // Mock machine translation - in real implementation, integrate with DeepL/Google/AWS
    const translations = {};
    targetLocales.forEach(locale => {
      translations[locale] = `[${locale.toUpperCase()}] ${text}`;
    });
    
    res.json({
      success: true,
      data: {
        source: text,
        sourceLocale,
        translations
      }
    });
  } catch (error) {
    logger.error('Error translating text:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to translate text'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Keephy Translations Service running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  mongoose.connection.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  mongoose.connection.close();
  process.exit(0);
});