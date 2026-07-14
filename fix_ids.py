import os, glob

for file in glob.glob("app/api/v1/*.py"):
    with open(file, "r") as f:
        content = f.read()
    
    # Revert str to int for IDs
    content = content.replace("student_id: str", "student_id: int")
    content = content.replace("user_id: str", "user_id: int")
    
    # Fix to_dict to remove _id
    old_to_dict = 'obj["id"] = obj.get("id", str(obj.get("_id")))\n    return obj'
    new_to_dict = 'obj["id"] = obj.get("id", str(obj.get("_id")))\n    obj.pop("_id", None)\n    return obj'
    content = content.replace(old_to_dict, new_to_dict)
    
    with open(file, "w") as f:
        f.write(content)
print("Fixed!")
