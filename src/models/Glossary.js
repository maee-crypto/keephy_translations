/**
 * Glossary Model
 * Represents tenant-specific translation glossaries and overrides
 */

import mongoose from 'mongoose';

const glossarySchema = new mongoose.Schema({
  tenantId: {
    type: String,
    required: true,
    index: true
  },
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    index: true
  },
  term: {
    type: String,
    required: true,
    maxlength: 100
  },
  translations: [{
    locale: {
      type: String,
      required: true,
      maxlength: 10
    },
    value: {
      type: String,
      required: true,
      maxlength: 500
    },
    context: {
      type: String,
      maxlength: 200
    },
    isPreferred: {
      type: Boolean,
      default: false
    }
  }],
  category: {
    type: String,
    enum: ['business', 'industry', 'technical', 'marketing', 'legal', 'custom'],
    default: 'business'
  },
  metadata: {
    createdBy: {
      type: String,
      required: true
    },
    lastUsed: Date,
    usageCount: {
      type: Number,
      default: 0
    },
    tags: [String],
    notes: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes
glossarySchema.index({ tenantId: 1, term: 1 }, { unique: true });
glossarySchema.index({ businessId: 1, term: 1 });
glossarySchema.index({ category: 1, isActive: 1 });
glossarySchema.index({ 'metadata.createdBy': 1 });
glossarySchema.index({ createdAt: -1 });

// Pre-save middleware
glossarySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Methods
glossarySchema.methods.getTranslation = function(locale) {
  const translation = this.translations.find(t => t.locale === locale);
  if (translation) return translation.value;
  
  // Fallback to preferred translation
  const preferred = this.translations.find(t => t.isPreferred);
  if (preferred) return preferred.value;
  
  // Fallback to first available translation
  if (this.translations.length > 0) {
    return this.translations[0].value;
  }
  
  return this.term; // Fallback to original term
};

glossarySchema.methods.addTranslation = function(locale, value, context = '', isPreferred = false) {
  // Remove existing translation for this locale
  this.translations = this.translations.filter(t => t.locale !== locale);
  
  // Add new translation
  this.translations.push({
    locale,
    value,
    context,
    isPreferred
  });
  
  // If this is marked as preferred, unmark others
  if (isPreferred) {
    this.translations.forEach(t => {
      if (t.locale !== locale) t.isPreferred = false;
    });
  }
  
  return this.save();
};

glossarySchema.methods.incrementUsage = function() {
  this.metadata.usageCount += 1;
  this.metadata.lastUsed = new Date();
  return this.save();
};

// Static methods
glossarySchema.statics.getTenantGlossary = function(tenantId, locale) {
  return this.find({
    tenantId,
    isActive: true
  })
  .select('term translations')
  .lean();
};

glossarySchema.statics.searchTerms = function(tenantId, query, limit = 20) {
  return this.find({
    tenantId,
    term: { $regex: query, $options: 'i' },
    isActive: true
  })
  .sort({ 'metadata.usageCount': -1, term: 1 })
  .limit(limit)
  .lean();
};

glossarySchema.statics.getMostUsedTerms = function(tenantId, limit = 10) {
  return this.find({
    tenantId,
    isActive: true
  })
  .sort({ 'metadata.usageCount': -1 })
  .limit(limit)
  .lean();
};

export default mongoose.model('Glossary', glossarySchema);
