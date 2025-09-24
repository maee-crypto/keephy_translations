/**
 * Translation Model
 * Represents translation keys and their values across locales
 */

import mongoose from 'mongoose';

const translationSchema = new mongoose.Schema({
  namespace: {
    type: String,
    required: true,
    enum: ['ui', 'emails', 'notifications', 'reports', 'forms', 'errors', 'validation'],
    index: true
  },
  key: {
    type: String,
    required: true,
    maxlength: 200
  },
  locale: {
    type: String,
    required: true,
    maxlength: 10,
    index: true
  },
  value: {
    type: String,
    required: true,
    maxlength: 2000
  },
  context: {
    type: String,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['draft', 'reviewed', 'published', 'archived'],
    default: 'draft',
    index: true
  },
  metadata: {
    createdBy: {
      type: String,
      required: true
    },
    reviewedBy: String,
    reviewedAt: Date,
    publishedAt: Date,
    source: {
      type: String,
      enum: ['manual', 'machine', 'import', 'api'],
      default: 'manual'
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 1
    },
    tags: [String],
    notes: String
  },
  variables: [{
    name: String,
    type: {
      type: String,
      enum: ['string', 'number', 'date', 'currency', 'plural'],
      default: 'string'
    },
    required: {
      type: Boolean,
      default: false
    },
    description: String
  }],
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
translationSchema.index({ namespace: 1, key: 1, locale: 1 }, { unique: true });
translationSchema.index({ namespace: 1, locale: 1 });
translationSchema.index({ status: 1, isActive: 1 });
translationSchema.index({ 'metadata.createdBy': 1 });
translationSchema.index({ createdAt: -1 });

// Pre-save middleware
translationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  if (this.status === 'published' && !this.metadata.publishedAt) {
    this.metadata.publishedAt = new Date();
  }
  
  next();
});

// Methods
translationSchema.methods.publish = function() {
  this.status = 'published';
  this.metadata.publishedAt = new Date();
  return this.save();
};

translationSchema.methods.archive = function() {
  this.status = 'archived';
  this.isActive = false;
  return this.save();
};

translationSchema.methods.review = function(reviewedBy) {
  this.status = 'reviewed';
  this.metadata.reviewedBy = reviewedBy;
  this.metadata.reviewedAt = new Date();
  return this.save();
};

// Static methods
translationSchema.statics.getBundle = function(namespace, locale, status = 'published') {
  return this.find({
    namespace,
    locale,
    status,
    isActive: true
  })
  .select('key value variables')
  .lean();
};

translationSchema.statics.getBundles = function(namespaces, locales, status = 'published') {
  return this.find({
    namespace: { $in: namespaces },
    locale: { $in: locales },
    status,
    isActive: true
  })
  .select('namespace key locale value variables')
  .lean();
};

translationSchema.statics.getMissingKeys = function(namespace, locales) {
  return this.aggregate([
    {
      $match: {
        namespace,
        isActive: true,
        status: 'published'
      }
    },
    {
      $group: {
        _id: '$key',
        locales: { $addToSet: '$locale' }
      }
    },
    {
      $project: {
        key: '$_id',
        locales: 1,
        missing: {
          $setDifference: [locales, '$locales']
        }
      }
    },
    {
      $match: {
        missing: { $ne: [] }
      }
    }
  ]);
};

translationSchema.statics.getTranslationStats = function(namespace, locale) {
  return this.aggregate([
    {
      $match: {
        namespace,
        locale,
        isActive: true
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
};

export default mongoose.model('Translation', translationSchema);
