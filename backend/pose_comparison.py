import numpy as np

def calculate_pose_similarity(landmarks_user1, landmarks_user2):
    if len(landmarks_user1) != len(landmarks_user2):
        return 0  # If the landmarks' count doesn't match, return 0 similarity
    
    similarity_score = 0
    for lm1, lm2 in zip(landmarks_user1, landmarks_user2):
        distance = np.sqrt((lm1['x'] - lm2['x'])**2 + (lm1['y'] - lm2['y'])**2 + (lm1['z'] - lm2['z'])**2)
        similarity_score += distance
    
    return max(0, 1 - similarity_score)
