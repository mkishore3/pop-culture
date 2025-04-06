import numpy as np
from typing import List, Tuple, Optional

def calculate_movement_vector(pose1: List[Tuple[float, float]], 
                           pose2: List[Tuple[float, float]]) -> Optional[List[Tuple[float, float]]]:
    """
    Calculate the movement vector between two poses.
    Each pose is a list of (x, y) coordinates for body landmarks.
    Returns a list of (dx, dy) vectors representing the movement of each landmark.
    """
    if not pose1 or not pose2 or len(pose1) != len(pose2):
        return None
    
    movement_vector = []
    for (x1, y1), (x2, y2) in zip(pose1, pose2):
        movement_vector.append((x2 - x1, y2 - y1))
    return movement_vector

def calculate_cosine_similarity(vec1: List[Tuple[float, float]], 
                              vec2: List[Tuple[float, float]]) -> float:
    """
    Calculate cosine similarity between two movement vectors.
    Returns a value between -1 and 1, where 1 means identical movement patterns.
    """
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0
    
    # Convert to numpy arrays for easier calculation
    vec1_array = np.array(vec1)
    vec2_array = np.array(vec2)
    
    # Flatten the vectors
    vec1_flat = vec1_array.flatten()
    vec2_flat = vec2_array.flatten()
    
    # Calculate dot product
    dot_product = np.dot(vec1_flat, vec2_flat)
    
    # Calculate magnitudes
    magnitude1 = np.linalg.norm(vec1_flat)
    magnitude2 = np.linalg.norm(vec2_flat)
    
    if magnitude1 == 0 or magnitude2 == 0:
        return 0.0
    
    return dot_product / (magnitude1 * magnitude2)

def calculate_pose_similarity(reference_poses: List[List[Tuple[float, float]]],
                            user_poses: List[List[Tuple[float, float]]]) -> float:
    """
    Calculate the similarity between two sequences of poses.
    Uses relative movement vectors and cosine similarity to compare movement patterns.
    Returns a score between 0 and 100.
    """
    if len(reference_poses) < 2 or len(user_poses) < 2:
        return 0.0
    
    # Calculate movement vectors for both sequences
    ref_vectors = []
    user_vectors = []
    
    # Calculate vectors for reference video
    for i in range(1, len(reference_poses)):
        vector = calculate_movement_vector(reference_poses[i-1], reference_poses[i])
        if vector:
            ref_vectors.append(vector)
    
    # Calculate vectors for user video
    for i in range(1, len(user_poses)):
        vector = calculate_movement_vector(user_poses[i-1], user_poses[i])
        if vector:
            user_vectors.append(vector)
    
    # Normalize the number of vectors to compare
    min_length = min(len(ref_vectors), len(user_vectors))
    if min_length == 0:
        return 0.0
    
    ref_vectors = ref_vectors[:min_length]
    user_vectors = user_vectors[:min_length]
    
    # Calculate similarity for each pair of vectors
    similarities = []
    for ref_vec, user_vec in zip(ref_vectors, user_vectors):
        similarity = calculate_cosine_similarity(ref_vec, user_vec)
        if not np.isnan(similarity):
            similarities.append(similarity)
    
    if not similarities:
        return 0.0
    
    # Convert to percentage and return average similarity
    return (np.mean(similarities) * 100) 