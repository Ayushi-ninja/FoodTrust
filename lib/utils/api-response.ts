import { NextResponse } from "next/server";

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
  timestamp: string;
}

export interface ApiErrorResponse<E = unknown> {
  success: false;
  error?: E;
  message: string;
  timestamp: string;
}

export type ApiResponse<T = unknown, E = unknown> =
  | ApiSuccessResponse<T>
  | ApiErrorResponse<E>;

/**
 * Returns a standardized success JSON response
 */
export function successResponse<T>(
  data?: T,
  message = "Operation completed successfully",
  status = 200,
  headers?: HeadersInit
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      message,
      timestamp: new Date().toISOString(),
    },
    { status, headers }
  );
}

/**
 * Returns a standardized error JSON response
 */
export function errorResponse<E>(
  message = "An error occurred",
  status = 400,
  error?: E,
  headers?: HeadersInit
): NextResponse<ApiErrorResponse<E>> {
  return NextResponse.json(
    {
      success: false,
      message,
      error,
      timestamp: new Date().toISOString(),
    },
    { status, headers }
  );
}
