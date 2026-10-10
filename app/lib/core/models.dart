// Typed views of the Tideover API's JSON. Hand-written (no codegen) and tolerant
// of missing fields so older/newer servers don't crash the app.

typedef Json = Map<String, dynamic>;

List<T> _list<T>(dynamic v, T Function(Json) f) =>
    v is List ? v.whereType<Map<String, dynamic>>().map(f).toList() : <T>[];
List<String> _strings(dynamic v) => v is List ? v.map((e) => '$e').toList() : const [];
int? _int(dynamic v) => v is num ? v.round() : null;
double? _double(dynamic v) => v is num ? v.toDouble() : null;
String? _str(dynamic v) => v is String ? v : null;
Json _map(dynamic v) => v is Map<String, dynamic> ? v : <String, dynamic>{};
DateTime? _time(dynamic v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

class AppInfo {
  AppInfo(this.raw);
  final Json raw;
  String get paypalMode => _str(_map(raw['paypal'])['mode']) ?? 'simulated';
  String? get paypalClientId => _str(_map(raw['paypal'])['clientId']);
  String get aiMode => _str(_map(raw['ai'])['mode']) ?? 'heuristic';
  String get aiModel => _str(_map(raw['ai'])['model']) ?? '';
  String get mcpUrl => _str(raw['mcpUrl']) ?? '';
  String get publicUrl => _str(raw['publicUrl']) ?? '';
  bool get simulated => paypalMode == 'simulated';
  bool get demoLogins => raw['demoLogins'] == true;
}

class FundCategory {
  FundCategory(Json j)
      : key = _str(j['key']) ?? '',
        label = _str(j['label']) ?? '',
        maxCents = _int(j['maxCents']) ?? 0,
        examples = _strings(j['examples']),
        evidence = _strings(j['evidence']);
  final String key;
  final String label;
  final int maxCents;
  final List<String> examples;
  final List<String> evidence;
}

class Criterion {
  Criterion(Json j)
      : id = _str(j['id']) ?? '',
        text = _str(j['text']) ?? '',
        kind = _str(j['kind']) ?? 'required';
  final String id;
  final String text;
  final String kind;
}

class FundStats {
  FundStats(Json j)
      : raisedCents = _int(j['raisedCents']) ?? 0,
        donationsCount = _int(j['donationsCount']) ?? 0,
        grantedCents = _int(j['grantedCents']) ?? 0,
        peopleHelped = _int(j['peopleHelped']) ?? 0,
        medianMinutesToCash = _double(j['medianMinutesToCash']),
        availableCents = _int(j['availableCents']) ?? 0,
        awaitingCount = _int(j['awaitingCount']) ?? 0,
        awaitingCents = _int(j['awaitingCents']) ?? 0,
        inReviewCount = _int(j['inReviewCount']) ?? 0;
  final int raisedCents;
  final int donationsCount;
  final int grantedCents;
  final int peopleHelped;
  final double? medianMinutesToCash;
  final int availableCents;
  final int awaitingCount;
  final int awaitingCents;
  final int inReviewCount;
}

class FeedItem {
  FeedItem(Json j)
      : id = _str(j['id']) ?? '',
        kind = _str(j['kind']) ?? 'grant',
        at = _time(j['at']),
        amountCents = _int(j['amountCents']) ?? 0,
        text = _str(j['text']) ?? '',
        categoryLabel = _str(j['categoryLabel']),
        minutesToCash = _double(j['minutesToCash']),
        viaAgent = j['viaAgent'] == true;
  final String id;
  final String kind;
  final DateTime? at;
  final int amountCents;
  final String text;
  final String? categoryLabel;
  final double? minutesToCash;
  final bool viaAgent;
}

class Need {
  Need(Json j)
      : id = _str(j['id']) ?? '',
        categoryLabel = _str(j['categoryLabel']) ?? 'Emergency expense',
        amountCents = _int(j['amountCents']) ?? 0,
        approvedAt = _time(j['approvedAt']),
        story = _str(j['story']),
        location = _str(j['location']),
        urgency = _str(j['urgency']);
  final String id;
  final String categoryLabel;
  final int amountCents;
  final DateTime? approvedAt;
  final String? story;
  final String? location;
  final String? urgency;
}

class Fund {
  Fund(this.raw)
      : id = _str(raw['id']) ?? '',
        slug = _str(raw['slug']) ?? '',
        name = _str(raw['name']) ?? '',
        tagline = _str(raw['tagline']) ?? '',
        description = _str(raw['description']) ?? '',
        region = _str(raw['region']) ?? '',
        currency = _str(raw['currency']) ?? 'USD',
        accentColor = _str(raw['accentColor']) ?? '#0E7C66',
        status = _str(raw['status']) ?? 'open',
        summary = _str(raw['summary']) ?? '',
        categories = _list(raw['categories'], FundCategory.new),
        maxGrantCents = _int(raw['maxGrantCents']) ?? 0,
        autoApproveLimitCents = _int(raw['autoApproveLimitCents']) ?? 0,
        stats = FundStats(_map(raw['stats'])),
        feed = _list(raw['feed'], FeedItem.new),
        needs = _list(raw['needs'], Need.new),
        policyText = _str(raw['policyText']),
        criteria = _list(raw['criteria'], Criterion.new);
  final Json raw;
  final String id;
  final String slug;
  final String name;
  final String tagline;
  final String description;
  final String region;
  final String currency;
  final String accentColor;
  final String status;
  final String summary;
  final List<FundCategory> categories;
  final int maxGrantCents;
  final int autoApproveLimitCents;
  final FundStats stats;
  final List<FeedItem> feed;
  final List<Need> needs;
  final String? policyText;
  final List<Criterion> criteria;
}

// ------------------------------------------------------------- applicant

class ChatMessage {
  ChatMessage({required this.id, required this.role, required this.content, this.meta = const {}, this.createdAt});
  factory ChatMessage.fromJson(Json j) => ChatMessage(
        id: _str(j['id']) ?? '',
        role: _str(j['role']) ?? 'event',
        content: _str(j['content']) ?? '',
        meta: _map(j['meta']),
        createdAt: _time(j['createdAt']),
      );
  final String id;
  final String role; // user | assistant | event
  final String content;
  final Json meta;
  final DateTime? createdAt;
  String? get ui => _str(meta['ui']);
}

class DocInfo {
  DocInfo(Json j)
      : id = _str(j['id']) ?? '',
        filename = _str(j['filename']) ?? '',
        mimeType = _str(j['mimeType']) ?? '',
        status = _str(j['status']) ?? 'processing',
        summary = _str(j['summary']),
        extraction = j['extraction'] is Map<String, dynamic> ? DocExtraction(j['extraction'] as Json) : null,
        createdAt = _time(j['createdAt']);
  final String id;
  final String filename;
  final String mimeType;
  final String status;
  final String? summary;
  final DocExtraction? extraction;
  final DateTime? createdAt;
  bool get isImage => mimeType.startsWith('image/');
}

class TimelineStep {
  TimelineStep(Json j)
      : key = _str(j['key']) ?? '',
        label = _str(j['label']) ?? '',
        at = _time(j['at']),
        state = _str(j['state']) ?? 'todo';
  final String key;
  final String label;
  final DateTime? at;
  final String state; // done | current | todo | failed
}

class RequestView {
  RequestView(this.raw)
      : id = _str(raw['id']) ?? '',
        publicRef = _str(raw['publicRef']) ?? '',
        status = _str(raw['status']) ?? 'intake',
        language = _str(raw['language']) ?? 'en',
        fundSlug = _str(_map(raw['fund'])['slug']) ?? '',
        fundName = _str(_map(raw['fund'])['name']) ?? '',
        fundRegion = _str(_map(raw['fund'])['region']) ?? '',
        accentColor = _str(_map(raw['fund'])['accentColor']) ?? '#0E7C66',
        categories = _list(_map(raw['fund'])['categories'], FundCategory.new),
        maxGrantCents = _int(_map(raw['fund'])['maxGrantCents']) ?? 0,
        firstName = _str(_map(raw['request'])['firstName']),
        category = _str(_map(raw['request'])['category']),
        categoryLabel = _str(_map(raw['request'])['categoryLabel']),
        amountRequestedCents = _int(_map(raw['request'])['amountRequestedCents']),
        needSummary = _str(_map(raw['request'])['needSummary']),
        urgency = _str(_map(raw['request'])['urgency']),
        location = _str(_map(raw['request'])['location']),
        readyToSubmit = raw['readyToSubmit'] == true,
        documentRequest = raw['documentRequest'] is Map<String, dynamic> ? raw['documentRequest'] as Json : null,
        payoutMethod = _str(_map(raw['payout'])['method']),
        payoutDisplay = _str(_map(raw['payout'])['display']),
        payoutVerified = _map(raw['payout'])['verified'] == true,
        paypalName = _str(_map(raw['payout'])['paypalName']),
        consentPublicStory = raw['consentPublicStory'] == true,
        documents = _list(raw['documents'], DocInfo.new),
        messages = _list(raw['messages'], ChatMessage.fromJson),
        amountApprovedCents = _int(_map(raw['decision'])['amountApprovedCents']),
        decisionNote = _str(_map(raw['decision'])['note']),
        payoutStatus = _str(raw['payoutStatus']),
        submittedAt = _time(raw['submittedAt']),
        paidAt = _time(raw['paidAt']),
        minutesToCash = _double(raw['minutesToCash']),
        timeline = _list(raw['timeline'], TimelineStep.new);
  final Json raw;
  final String id;
  final String publicRef;
  final String status;
  final String language;
  final String fundSlug;
  final String fundName;
  final String fundRegion;
  final String accentColor;
  final List<FundCategory> categories;
  final int maxGrantCents;
  final String? firstName;
  final String? category;
  final String? categoryLabel;
  final int? amountRequestedCents;
  final String? needSummary;
  final String? urgency;
  final String? location;
  final bool readyToSubmit;
  final Json? documentRequest;
  final String? payoutMethod;
  final String? payoutDisplay;
  final bool payoutVerified;
  final String? paypalName;
  final bool consentPublicStory;
  final List<DocInfo> documents;
  final List<ChatMessage> messages;
  final int? amountApprovedCents;
  final String? decisionNote;
  final String? payoutStatus;
  final DateTime? submittedAt;
  final DateTime? paidAt;
  final double? minutesToCash;
  final List<TimelineStep> timeline;

  bool get isIntake => status == 'intake';
  bool get acceptsMessages => const ['intake', 'needs_info', 'in_review', 'submitted'].contains(status);
  bool get acceptsDocuments => const ['intake', 'needs_info', 'in_review', 'submitted'].contains(status);
  bool get canChangePayout => !const ['paying', 'paid', 'denied', 'withdrawn', 'unclaimed'].contains(status);
}

// ------------------------------------------------------------------ staff

class RiskFlag {
  RiskFlag(Json j)
      : code = _str(j['code']) ?? '',
        severity = _str(j['severity']) ?? 'info',
        message = _str(j['message']) ?? '';
  final String code;
  final String severity;
  final String message;
}

class CriterionVerdict {
  CriterionVerdict(Json j)
      : id = _str(j['id']) ?? '',
        text = _str(j['text']) ?? '',
        verdict = _str(j['verdict']) ?? 'unclear',
        evidence = _str(j['evidence']) ?? '';
  final String id;
  final String text;
  final String verdict;
  final String evidence;
}

class Assessment {
  Assessment(Json j)
      : model = _str(j['model']) ?? '',
        summary = _str(j['summary']) ?? '',
        recommendation = _str(j['recommendation']) ?? 'needs_info',
        recommendedAmountCents = _int(j['recommendedAmountCents']) ?? 0,
        confidence = _double(j['confidence']) ?? 0,
        criteria = _list(j['criteria'], CriterionVerdict.new),
        documentFindings = _strings(j['documentFindings']),
        questionsForApplicant = _strings(j['questionsForApplicant']),
        riskNotes = _strings(j['riskNotes']),
        reviewerNote = _str(j['reviewerNote']) ?? '',
        createdAt = _time(j['createdAt']);
  final String model;
  final String summary;
  final String recommendation;
  final int recommendedAmountCents;
  final double confidence;
  final List<CriterionVerdict> criteria;
  final List<String> documentFindings;
  final List<String> questionsForApplicant;
  final List<String> riskNotes;
  final String reviewerNote;
  final DateTime? createdAt;
}

class DocExtraction {
  DocExtraction(Json j)
      : docType = _str(j['docType']) ?? 'other',
        title = _str(j['title']) ?? '',
        issuer = _str(j['issuer']),
        recipientName = _str(j['recipientName']),
        amountCents = _int(j['amountCents']),
        dueDate = _str(j['dueDate']),
        documentDate = _str(j['documentDate']),
        summary = _str(j['summary']) ?? '',
        legible = j['legible'] != false,
        consistencyNotes = _strings(j['consistencyNotes']),
        redFlags = _strings(j['redFlags']);
  final String docType;
  final String title;
  final String? issuer;
  final String? recipientName;
  final int? amountCents;
  final String? dueDate;
  final String? documentDate;
  final String summary;
  final bool legible;
  final List<String> consistencyNotes;
  final List<String> redFlags;
}

class CaseSummary {
  CaseSummary(this.raw)
      : id = _str(raw['id']) ?? '',
        publicRef = _str(raw['publicRef']) ?? '',
        fundName = _str(raw['fundName']) ?? '',
        fundSlug = _str(raw['fundSlug']) ?? '',
        status = _str(raw['status']) ?? '',
        language = _str(raw['language']) ?? 'en',
        firstName = _str(raw['firstName']),
        category = _str(raw['category']),
        categoryLabel = _str(raw['categoryLabel']),
        amountRequestedCents = _int(raw['amountRequestedCents']),
        amountRecommendedCents = _int(raw['amountRecommendedCents']),
        amountApprovedCents = _int(raw['amountApprovedCents']),
        needSummary = _str(raw['needSummary']),
        aiRecommendation = _str(raw['aiRecommendation']),
        aiConfidence = _double(raw['aiConfidence']),
        aiStatus = _str(raw['aiStatus']) ?? 'idle',
        riskLevel = _str(raw['riskLevel']) ?? 'low',
        riskCount = _int(raw['riskCount']) ?? 0,
        payoutMethod = _str(raw['payoutMethod']),
        payoutVerified = raw['payoutVerified'] == true,
        location = _str(raw['location']),
        urgency = _str(raw['urgency']),
        submittedAt = _time(raw['submittedAt']),
        decidedAt = _time(raw['decidedAt']),
        paidAt = _time(raw['paidAt']),
        createdAt = _time(raw['createdAt']),
        minutesToCash = _double(raw['minutesToCash']);
  final Json raw;
  final String id;
  final String publicRef;
  final String fundName;
  final String fundSlug;
  final String status;
  final String language;
  final String? firstName;
  final String? category;
  final String? categoryLabel;
  final int? amountRequestedCents;
  final int? amountRecommendedCents;
  final int? amountApprovedCents;
  final String? needSummary;
  final String? aiRecommendation;
  final double? aiConfidence;
  final String aiStatus;
  final String riskLevel;
  final int riskCount;
  final String? payoutMethod;
  final bool payoutVerified;
  final String? location;
  final String? urgency;
  final DateTime? submittedAt;
  final DateTime? decidedAt;
  final DateTime? paidAt;
  final DateTime? createdAt;
  final double? minutesToCash;
}

class StaffDoc {
  StaffDoc(Json j)
      : id = _str(j['id']) ?? '',
        filename = _str(j['filename']) ?? '',
        mimeType = _str(j['mimeType']) ?? '',
        status = _str(j['status']) ?? '',
        extraction = j['extraction'] is Map<String, dynamic> ? DocExtraction(j['extraction'] as Json) : null;
  final String id;
  final String filename;
  final String mimeType;
  final String status;
  final DocExtraction? extraction;
  bool get isImage => mimeType.startsWith('image/');
}

class ReviewInfo {
  ReviewInfo(Json j)
      : reviewerName = _str(j['reviewerName']) ?? '',
        reviewerId = _str(j['reviewerId']),
        decision = _str(j['decision']) ?? '',
        amountCents = _int(j['amountCents']),
        note = _str(j['note']),
        createdAt = _time(j['createdAt']);
  final String reviewerName;
  final String? reviewerId;
  final String decision;
  final int? amountCents;
  final String? note;
  final DateTime? createdAt;
}

class PayoutInfo {
  PayoutInfo(this.raw)
      : id = _str(raw['id']) ?? '',
        applicationId = _str(raw['applicationId']) ?? '',
        publicRef = _str(raw['publicRef']),
        fundName = _str(raw['fundName']),
        amountCents = _int(raw['amountCents']) ?? 0,
        status = _str(raw['status']) ?? '',
        method = _str(raw['method']) ?? '',
        receiver = _str(raw['receiver']),
        paypalBatchId = _str(raw['paypalBatchId']),
        paypalItemId = _str(raw['paypalItemId']),
        paypalTransactionId = _str(raw['paypalTransactionId']),
        feeCents = _int(raw['feeCents']),
        errorMessage = _str(raw['errorMessage']),
        createdAt = _time(raw['createdAt']),
        sentAt = _time(raw['sentAt']),
        completedAt = _time(raw['completedAt']);
  final Json raw;
  final String id;
  final String applicationId;
  final String? publicRef;
  final String? fundName;
  final int amountCents;
  final String status;
  final String method;
  final String? receiver;
  final String? paypalBatchId;
  final String? paypalItemId;
  final String? paypalTransactionId;
  final int? feeCents;
  final String? errorMessage;
  final DateTime? createdAt;
  final DateTime? sentAt;
  final DateTime? completedAt;
}

class DonationInfo {
  DonationInfo(this.raw)
      : id = _str(raw['id']) ?? '',
        applicationId = _str(raw['applicationId']),
        fundName = _str(raw['fundName']),
        amountCents = _int(raw['amountCents']) ?? 0,
        status = _str(raw['status']) ?? '',
        donorName = _str(raw['donorName']),
        donorEmail = _str(raw['donorEmail']),
        donorMessage = _str(raw['donorMessage']),
        anonymous = raw['anonymous'] == true,
        source = _str(raw['source']) ?? 'web',
        agentName = _str(raw['agentName']),
        paypalCaptureId = _str(raw['paypalCaptureId']),
        feeCents = _int(raw['feeCents']),
        createdAt = _time(raw['createdAt']),
        capturedAt = _time(raw['capturedAt']);
  final Json raw;
  final String id;
  final String? applicationId;
  final String? fundName;
  final int amountCents;
  final String status;
  final String? donorName;
  final String? donorEmail;
  final String? donorMessage;
  final bool anonymous;
  final String source;
  final String? agentName;
  final String? paypalCaptureId;
  final int? feeCents;
  final DateTime? createdAt;
  final DateTime? capturedAt;
}

class AuditItem {
  AuditItem(Json j)
      : id = _str(j['id']) ?? '',
        entityType = _str(j['entityType']) ?? '',
        entityId = _str(j['entityId']) ?? '',
        actorType = _str(j['actorType']) ?? 'system',
        actorName = _str(j['actorName']),
        action = _str(j['action']) ?? '',
        summary = _str(j['summary']) ?? '',
        createdAt = _time(j['createdAt']);
  final String id;
  final String entityType;
  final String entityId;
  final String actorType;
  final String? actorName;
  final String action;
  final String summary;
  final DateTime? createdAt;
}

class CaseDetail extends CaseSummary {
  CaseDetail(super.raw)
      : criteria = _list(_map(raw['fund'])['criteria'], Criterion.new),
        fundCategories = _list(_map(raw['fund'])['categories'], FundCategory.new),
        fundId = _str(_map(raw['fund'])['id']) ?? '',
        autoApproveLimitCents = _int(_map(raw['fund'])['autoApproveLimitCents']) ?? 0,
        dualApprovalAboveCents = _int(_map(raw['fund'])['dualApprovalAboveCents']) ?? 0,
        facts = _map(raw['facts']),
        assessment = raw['assessment'] is Map<String, dynamic> ? Assessment(raw['assessment'] as Json) : null,
        riskFlags = _list(raw['riskFlags'], RiskFlag.new),
        applicant = _map(raw['applicant']),
        payoutReceiver = _str(_map(raw['payout'])['receiver']),
        consentPublicStory = raw['consentPublicStory'] == true,
        publicStory = _str(raw['publicStory']),
        decisionNote = _str(raw['decisionNote']),
        approvalsNeeded = _int(raw['approvalsNeeded']) ?? 1,
        documents = _list(raw['documents'], StaffDoc.new),
        messages = _list(raw['messages'], ChatMessage.fromJson),
        reviews = _list(raw['reviews'], ReviewInfo.new),
        payouts = _list(raw['payouts'], PayoutInfo.new),
        audit = _list(raw['audit'], AuditItem.new);
  final List<Criterion> criteria;
  final List<FundCategory> fundCategories;
  final String fundId;
  final int autoApproveLimitCents;
  final int dualApprovalAboveCents;
  final Json facts;
  final Assessment? assessment;
  final List<RiskFlag> riskFlags;
  final Json applicant;
  final String? payoutReceiver;
  final bool consentPublicStory;
  final String? publicStory;
  final String? decisionNote;
  final int approvalsNeeded;
  final List<StaffDoc> documents;
  final List<ChatMessage> messages;
  final List<ReviewInfo> reviews;
  final List<PayoutInfo> payouts;
  final List<AuditItem> audit;

  bool get decidable => const ['submitted', 'needs_info', 'in_review'].contains(status);
}

class DashboardData {
  DashboardData(this.raw)
      : funds = _list(raw['funds'], Fund.new),
        byStatus = _map(raw['byStatus']).map((k, v) => MapEntry(k, _int(v) ?? 0)),
        series = _list(raw['series'], (j) => j),
        medianMinutesToCash = _double(raw['medianMinutesToCash']),
        aiAgreement = _double(raw['aiAgreement']),
        aiDecisions = _int(raw['aiDecisions']) ?? 0,
        aiMode = _str(_map(raw['ai'])['mode']) ?? '',
        aiModel = _str(_map(raw['ai'])['model']) ?? '',
        paypalMode = _str(_map(raw['paypal'])['mode']) ?? '',
        recent = _list(raw['recent'], AuditItem.new);
  final Json raw;
  final List<Fund> funds;
  final Map<String, int> byStatus;
  final List<Json> series;
  final double? medianMinutesToCash;
  final double? aiAgreement;
  final int aiDecisions;
  final String aiMode;
  final String aiModel;
  final String paypalMode;
  final List<AuditItem> recent;

  int count(List<String> statuses) => statuses.fold(0, (sum, s) => sum + (byStatus[s] ?? 0));
}

class StaffUser {
  StaffUser(Json j)
      : id = _str(j['id']) ?? '',
        name = _str(j['name']) ?? '',
        email = _str(j['email']) ?? '',
        role = _str(j['role']) ?? 'reviewer';
  final String id;
  final String name;
  final String email;
  final String role;
  bool get isAdmin => role == 'admin';
  Json toJson() => {'id': id, 'name': name, 'email': email, 'role': role};
}

class DonationStatus {
  DonationStatus(this.raw)
      : id = _str(raw['id']) ?? '',
        amountCents = _int(raw['amountCents']) ?? 0,
        status = _str(raw['status']) ?? '',
        source = _str(raw['source']) ?? 'web',
        fundSlug = _str(_map(raw['fund'])['slug']) ?? '',
        fundName = _str(_map(raw['fund'])['name']) ?? '',
        accentColor = _str(_map(raw['fund'])['accentColor']) ?? '#0E7C66',
        needCategory = _str(_map(raw['need'])['categoryLabel']),
        needAmountCents = _int(_map(raw['need'])['amountCents']),
        needStatus = _str(_map(raw['need'])['status']),
        needPaidAt = _time(_map(raw['need'])['paidAt']);
  final Json raw;
  final String id;
  final int amountCents;
  final String status;
  final String source;
  final String fundSlug;
  final String fundName;
  final String accentColor;
  final String? needCategory;
  final int? needAmountCents;
  final String? needStatus;
  final DateTime? needPaidAt;
  bool get hasNeed => raw['need'] is Map;
}
