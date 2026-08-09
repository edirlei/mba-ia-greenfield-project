export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoUploadTooLargeException extends DomainException {
  constructor() {
    super(
      'VIDEO_UPLOAD_TOO_LARGE',
      413,
      'Video size exceeds the 10 GB upload limit',
    );
  }
}

export class VideoUploadInvalidPartsException extends DomainException {
  constructor() {
    super(
      'VIDEO_UPLOAD_INVALID_PARTS',
      400,
      'Part numbers are invalid for this upload',
    );
  }
}

export class VideoUploadInvalidStateException extends DomainException {
  constructor() {
    super(
      'VIDEO_UPLOAD_INVALID_STATE',
      409,
      'Video is not available for this upload operation',
    );
  }
}

export class VideoStorageUnavailableException extends DomainException {
  constructor() {
    super(
      'VIDEO_STORAGE_UNAVAILABLE',
      502,
      'Video storage is temporarily unavailable',
    );
  }
}

export class VideoUploadObjectInvalidException extends DomainException {
  constructor() {
    super(
      'VIDEO_UPLOAD_OBJECT_INVALID',
      422,
      'Completed video object is missing or has an unexpected size',
    );
  }
}
