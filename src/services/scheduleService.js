/**
 * Academic Schedule Service
 * Integrates with Go backend on Fly.io (/api/v1/schedule/today)
 * Provides timetable queries, search, filter, and upcoming lecture calculations
 */

import { scheduleData } from '../data/scheduleData.js';
import { getSmartInitialDay, getTodayAcademicKey } from '../utils/dateUtils.js';
import { apiClient } from './apiClient.js';

export const scheduleService = {
  /**
   * Get courses for a specific academic day ('saturday', 'sunday', 'wednesday')
   * If requesting today's schedule, checks Fly.io backend for live check-in statuses
   */
  async getDaySchedule(dayKey) {
    const todayKey = getTodayAcademicKey();
    const localLectures = scheduleData[dayKey] || [];

    // If querying today and user has an active token, fetch live schedule data
    if (dayKey === todayKey && apiClient.getStoredAuthToken()) {
      try {
        const res = await apiClient.get('/schedule/today');
        if (res && Array.isArray(res.data) && res.data.length > 0) {
          // Merge live server status with rich course catalogue
          return localLectures.map((lec) => {
            const serverMatch = res.data.find(
              (s) => s.subject_name && lec.title.includes(s.subject_name)
            );
            if (serverMatch) {
              return {
                ...lec,
                hasCheckedIn: serverMatch.has_checked_in,
                isActiveNow: serverMatch.is_active_now,
                sessionId: serverMatch.session_id
              };
            }
            return lec;
          });
        }
      } catch {
        // Fallback to static catalog on network error
      }
    }

    return localLectures;
  },

  /**
   * Get all courses flattened across all 3 days
   */
  async getAllCourses() {
    const all = [];
    Object.keys(scheduleData).forEach((dayKey) => {
      (scheduleData[dayKey] || []).forEach((c) => {
        all.push({ ...c, dayKey });
      });
    });
    return all;
  },

  /**
   * Calculate next upcoming or active lecture
   */
  async getUpcomingLecture() {
    const smartDay = getSmartInitialDay();
    const dayLectures = scheduleData[smartDay] || scheduleData.saturday;
    return dayLectures[1] || dayLectures[0];
  },

  /**
   * Search and filter schedule entries
   */
  async filterSchedule({ dayKey = 'saturday', query = '', filterType = 'all' }) {
    const lectures = await this.getDaySchedule(dayKey);

    return lectures.filter((lecture) => {
      const matchesSearch =
        !query.trim() ||
        lecture.title.toLowerCase().includes(query.toLowerCase()) ||
        lecture.doctor.toLowerCase().includes(query.toLowerCase()) ||
        lecture.location.toLowerCase().includes(query.toLowerCase());

      const matchesType =
        filterType === 'all' ||
        (filterType === 'practical' && (lecture.isLab || lecture.status === 'معمل')) ||
        (filterType === 'theory' && (!lecture.isLab && lecture.status !== 'معمل'));

      return matchesSearch && matchesType;
    });
  }
};

export default scheduleService;
