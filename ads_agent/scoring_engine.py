import math

def safe_div(a, b):
    return a / b if b > 0 else 0

def score_linear(actual, target, weight, lower_is_better=True):
    """
    Standard linear scoring: 
    If actual == target, score = weight
    If lower_is_better: 100% score at actual <= target * 0.8, 0% at actual >= target * 1.5
    If not lower_is_better: 100% score at actual >= target * 1.2, 0% at actual <= target * 0.5
    """
    if target <= 0:
        return weight * 0.5, "no_data"
    
    if lower_is_better:
        if actual <= target * 0.8:
            return weight, "excellent"
        if actual >= target * 1.5:
            return 0, "poor"
        # Linear interp between 1.5 and 0.8
        ratio = actual / target
        # ratio 0.8 -> 1.0 score, ratio 1.5 -> 0.0 score
        score_ratio = (1.5 - ratio) / (1.5 - 0.8)
        score_ratio = max(0, min(1, score_ratio))
        band = "excellent" if ratio <= 1.0 else "watch" if ratio <= 1.3 else "poor"
        return round(weight * score_ratio, 2), band
    else:
        if actual >= target * 1.2:
            return weight, "excellent"
        if actual <= target * 0.5:
            return 0, "poor"
        # Linear interp between 0.5 and 1.2
        ratio = actual / target
        # ratio 1.2 -> 1.0 score, ratio 0.5 -> 0.0 score
        score_ratio = (ratio - 0.5) / (1.2 - 0.5)
        score_ratio = max(0, min(1, score_ratio))
        band = "excellent" if ratio >= 1.0 else "watch" if ratio >= 0.7 else "poor"
        return round(weight * score_ratio, 2), band

def score_impression_share(actual_is, target_is):
    """
    Google graded IS scoring:
    ≥ Target -> 100% score
    70% of target -> 75% score
    50% of target -> 40% score
    <50% of target -> 10% score
    """
    if target_is <= 0:
        return 50  # Default
    
    ratio = actual_is / target_is
    if ratio >= 1.0:
        return 100
    if ratio >= 0.7:
        # Interpolate between 75% and 100%
        return 75 + (ratio - 0.7) / (1.0 - 0.7) * 25
    if ratio >= 0.5:
        # Interpolate between 40% and 75%
        return 40 + (ratio - 0.5) / (0.7 - 0.5) * 35
    # Interpolate between 10% and 40%
    return max(10, 10 + (ratio / 0.5) * 30)

def normalize_score(score_map, total_weight=100):
    total = sum(score_map.values())
    if total_weight != 100:
        total = (total / total_weight) * 100
    return round(max(0, min(100, total)), 1)

def get_interpretation(score):
    if score >= 75: return "HEALTHY", "green"
    if score >= 50: return "WATCH", "yellow"
    return "PAUSE/INTERVENE", "red"

# --- Overall Health Functions ---

def calculate_meta_health(mtd_data, creative_avg):
    """
    Meta: CPSV (25), Budget (25), CPQL (20), CPL (20), Creative (10)
    """
    weights = {"cpsv": 25, "budget": 25, "cpql": 20, "cpl": 20, "creative": 10}
    scores = {}
    
    # Placeholder calculations — actual logic depends on targets passed
    # Assuming targets are in mtd_data["targets"]
    t = mtd_data.get("targets", {})
    m = mtd_data.get("mtd", {})
    
    scores["cpsv"], _ = score_linear(mtd_data.get("cpsv", 0), t.get("cpsv", 20000), weights["cpsv"], True)
    
    # Budget pacing score: 100 if dev < 10%, linear drop
    pacing_dev = abs(mtd_data.get("pacing_ratio", 1.0) - 1.0)
    scores["budget"] = round(weights["budget"] * max(0, 1 - (pacing_dev * 2)), 2)
    
    scores["cpql"], _ = score_linear(mtd_data.get("cpql", 0), t.get("cpql", 1500), weights["cpql"], True)
    scores["cpl"], _ = score_linear(mtd_data.get("cpl", 0), t.get("cpl", 850), weights["cpl"], True)
    scores["creative"] = round(creative_avg * (weights["creative"] / 100), 2)
    
    return {"score": normalize_score(scores), "breakdown": scores}

def calculate_google_health(mtd_data, campaign_avg, creative_avg):
    """
    Google: CPSV (25), Budget (20), CPQL (20), CPL (10), Campaign Avg (15), Creative Avg (10)
    """
    weights = {"cpsv": 25, "budget": 20, "cpql": 20, "cpl": 10, "campaign": 15, "creative": 10}
    scores = {}
    
    t = mtd_data.get("targets", {})
    scores["cpsv"], _ = score_linear(mtd_data.get("cpsv", 0), t.get("cpsv", 20000), weights["cpsv"], True)
    
    pacing_dev = abs(mtd_data.get("pacing_ratio", 1.0) - 1.0)
    scores["budget"] = round(weights["budget"] * max(0, 1 - (pacing_dev * 2)), 2)
    
    scores["cpql"], _ = score_linear(mtd_data.get("cpql", 0), t.get("cpql", 1500), weights["cpql"], True)
    scores["cpl"], _ = score_linear(mtd_data.get("cpl", 0), t.get("cpl", 850), weights["cpl"], True)
    
    scores["campaign"] = round(campaign_avg * (weights["campaign"] / 100), 2)
    scores["creative"] = round(creative_avg * (weights["creative"] / 100), 2)
    
    return {"score": normalize_score(scores), "breakdown": scores}

# --- Module Specific Scorers ---

def score_meta_campaign_module(data, target_cpl):
    """
    Meta Campaign: CPL (35), Freq (15), CPM (15), CTR (10), Leads (10), Budget (10), CVR (5)
    """
    w = {"cpl": 35, "freq": 15, "cpm": 15, "ctr": 10, "leads": 10, "budget": 10, "cvr": 5}
    scores = {}
    
    scores["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, w["cpl"], True)
    scores["freq"], _ = score_linear(data.get("frequency", 0), 1.8, w["freq"], True)
    scores["cpm"], _ = score_linear(data.get("cpm", 0), 200, w["cpm"], True)
    scores["ctr"], _ = score_linear(data.get("ctr", 0), 0.8, w["ctr"], False)
    
    # Lead volume vs expected (spend / target_cpl)
    expected_leads = data.get("spend", 0) / target_cpl if target_cpl > 0 else 0
    leads = data.get("leads", 0)
    scores["leads"] = round(w["leads"] * min(1, safe_div(leads, expected_leads)), 2) if expected_leads > 0 else w["leads"] * 0.5
    
    util = data.get("budget_utilization", 100)
    scores["budget"] = round(w["budget"] * (1 - min(1, abs(util - 100)/100)), 2)
    scores["cvr"], _ = score_linear(data.get("cvr", 0), 2.0, w["cvr"], False)
    
    return {"score": normalize_score(scores), "breakdown": scores}

def score_meta_creative_module(data, target_cpl):
    is_video = data.get("is_video", False)
    if is_video:
        # Meta Video: CPL (35), CPM (20), TSR (15), VHR (15), CTR (15)
        w = {"cpl": 35, "cpm": 20, "tsr": 15, "vhr": 15, "ctr": 15}
        scores = {}
        scores["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, w["cpl"], True)
        scores["cpm"], _ = score_linear(data.get("cpm", 0), 200, w["cpm"], True)
        scores["tsr"], _ = score_linear(data.get("thumb_stop_pct", 0), 25, w["tsr"], False)
        scores["vhr"], _ = score_linear(data.get("hold_rate_pct", 0), 25, w["vhr"], False)
        scores["ctr"], _ = score_linear(data.get("ctr", 0), 0.8, w["ctr"], False)
    else:
        # Meta Static: CPL (45), CPM (25), CTR (20), CPC (10)
        w = {"cpl": 45, "cpm": 25, "ctr": 20, "cpc": 10}
        scores = {}
        scores["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, w["cpl"], True)
        scores["cpm"], _ = score_linear(data.get("cpm", 0), 150, w["cpm"], True)
        scores["ctr"], _ = score_linear(data.get("ctr", 0), 0.6, w["ctr"], False)
        scores["cpc"], _ = score_linear(data.get("avg_cpc", 0), 40, w["cpc"], True)
    
    return {"score": normalize_score(scores), "breakdown": scores}

def score_google_campaign_module(data, target_cpl):
    """
    Google Search Campaign: CPL (25), CVR (22), CPC (20), QS (13), CTR (10), IS (10)
    """
    w = {"cpl": 25, "cvr": 22, "cpc": 20, "qs": 13, "ctr": 10, "is": 10}
    scores = {}
    
    scores["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, w["cpl"], True)
    scores["cvr"], _ = score_linear(data.get("cvr", 0), 3.5, w["cvr"], False)
    scores["cpc"], _ = score_linear(data.get("avg_cpc", 0), 30, w["cpc"], True)
    scores["qs"] = round(data.get("quality_score", 5) / 10 * w["qs"], 2)
    scores["ctr"], _ = score_linear(data.get("ctr", 0), 2.0, w["ctr"], False)
    
    # Impression Share
    ctype = data.get("campaign_type", "branded")
    is_target = 80 if "branded" in ctype.lower() else 40
    scores["is"] = round(score_impression_share(data.get("impression_share", 0), is_target) / 100 * w["is"], 2)
    
    return {"score": normalize_score(scores), "breakdown": scores}

def score_google_adgroup_module(data, target_cpl):
    """
    Google Search Ad Group: CPL (30), CVR (25), CTR (15), QS (15), IS (10), CPC (5)
    """
    w = {"cpl": 30, "cvr": 25, "ctr": 15, "qs": 15, "is": 10, "cpc": 5}
    scores = {}
    
    scores["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, w["cpl"], True)
    scores["cvr"], _ = score_linear(data.get("cvr", 0), 3.5, w["cvr"], False)
    scores["ctr"], _ = score_linear(data.get("ctr", 0), 2.0, w["ctr"], False)
    scores["qs"] = round(data.get("quality_score", 5) / 10 * w["qs"], 2)
    
    ctype = data.get("campaign_type", "location")
    is_target = 80 if "branded" in ctype.lower() else 40
    scores["is"] = round(score_impression_share(data.get("impression_share", 0), is_target) / 100 * w["is"], 2)
    scores["cpc"], _ = score_linear(data.get("avg_cpc", 0), 30, w["cpc"], True)
    
    return {"score": normalize_score(scores), "breakdown": scores}

def score_google_dg_module(data, target_cpl):
    """
    Google Demand Gen: CPL (25), CPM (20), CVR (15), CTR (15), TSR (7.5), Freq (10), VHR (7.5)
    """
    w = {"cpl": 25, "cpm": 20, "cvr": 15, "ctr": 15, "tsr": 7.5, "freq": 10, "vhr": 7.5}
    scores = {}
    
    scores["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, w["cpl"], True)
    scores["cpm"], _ = score_linear(data.get("avg_cpm", 0), 120, w["cpm"], True)
    scores["cvr"], _ = score_linear(data.get("cvr", 0), 1.5, w["cvr"], False)
    scores["ctr"], _ = score_linear(data.get("ctr", 0), 0.8, w["ctr"], False)
    scores["tsr"], _ = score_linear(data.get("tsr", 0), 3.5, w["tsr"], False)
    scores["freq"], _ = score_linear(data.get("frequency", 0), 2.0, w["freq"], True)
    scores["vhr"], _ = score_linear(data.get("vhr", 0), 30, w["vhr"], False)
    
    return {"score": normalize_score(scores), "breakdown": scores}

def score_google_rsa_module(data, target_cpl):
    """
    Google RSA: CPL (35), CTR (25), CVR (20), Ad Strength (10), Expected CTR (10)
    """
    w = {"cpl": 35, "ctr": 25, "cvr": 20, "ad_strength": 10, "expected_ctr": 10}
    scores = {}
    
    scores["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, w["cpl"], True)
    scores["ctr"], _ = score_linear(data.get("ctr", 0), 2.0, w["ctr"], False)
    scores["cvr"], _ = score_linear(data.get("cvr", 0), 3.0, w["cvr"], False)
    
    strength_map = {"EXCELLENT": 1.0, "GOOD": 0.8, "AVERAGE": 0.5, "POOR": 0.2, "LOW": 0.1, "UNSPECIFIED": 0.5}
    strength = data.get("ad_strength", "AVERAGE").upper()
    scores["ad_strength"] = round(strength_map.get(strength, 0.5) * w["ad_strength"], 2)
    
    exp_ctr_map = {"ABOVE_AVERAGE": 1.0, "AVERAGE": 0.6, "BELOW_AVERAGE": 0.2, "UNSPECIFIED": 0.5}
    exp_ctr = data.get("expected_ctr", "AVERAGE").upper()
    scores["expected_ctr"] = round(exp_ctr_map.get(exp_ctr, 0.5) * w["expected_ctr"], 2)
    
    return {"score": normalize_score(scores), "breakdown": scores}

def score_google_creative_module(data, target_cpl):
    is_video = "VIDEO" in data.get("type", "").upper() or data.get("is_video", False)
    if is_video:
        # Google Video: CPL (35), CPM (20), CTR (15), TSR (15), VHR (15)
        w = {"cpl": 35, "cpm": 20, "ctr": 15, "tsr": 15, "vhr": 15}
        scores = {}
        scores["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, w["cpl"], True)
        scores["cpm"], _ = score_linear(data.get("avg_cpm", 0), 120, w["cpm"], True)
        scores["ctr"], _ = score_linear(data.get("ctr", 0), 0.8, w["ctr"], False)
        scores["tsr"], _ = score_linear(data.get("tsr", 0), 3.5, w["tsr"], False)
        scores["vhr"], _ = score_linear(data.get("vhr", 0), 30, w["vhr"], False)
    else:
        # Google Static: CPL (45), CPM (25), CTR (20), CPC (10)
        w = {"cpl": 45, "cpm": 25, "ctr": 20, "cpc": 10}
        scores = {}
        scores["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, w["cpl"], True)
        scores["cpm"], _ = score_linear(data.get("avg_cpm", 0), 80, w["cpm"], True)
        scores["ctr"], _ = score_linear(data.get("ctr", 0), 0.6, w["ctr"], False)
        scores["cpc"], _ = score_linear(data.get("avg_cpc", 0), 20, w["cpc"], True)
    
    return {"score": normalize_score(scores), "breakdown": scores}

# --- Quality Score Page Scorer ---

def score_quality_score_page(data):
    """
    Quality Score Page: LP Exp (35), Expected CTR (35), Ad Relevance (30)
    """
    w = {"lp_exp": 35, "exp_ctr": 35, "ad_rel": 30}
    scores = {}
    
    mapping = {"ABOVE_AVERAGE": 1.0, "AVERAGE": 0.6, "BELOW_AVERAGE": 0.2, "UNSPECIFIED": 0.5}
    
    scores["lp_exp"] = round(mapping.get(data.get("landing_page_experience", "AVERAGE").upper(), 0.5) * w["lp_exp"], 2)
    scores["exp_ctr"] = round(mapping.get(data.get("expected_click_through_rate", "AVERAGE").upper(), 0.5) * w["exp_ctr"], 2)
    scores["ad_rel"] = round(mapping.get(data.get("ad_relevance", "AVERAGE").upper(), 0.5) * w["ad_rel"], 2)
    
    return {"score": normalize_score(scores), "breakdown": scores}
